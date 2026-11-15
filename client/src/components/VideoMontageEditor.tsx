import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { ArrowDown, ArrowUp, Download, LoaderCircle, Music2, Scissors, Trash2 } from 'lucide-react'

interface Clip {
  id: string
  file: File
  duration: number
  width: number
  height: number
  trimStart: number
  trimEnd: number
}

interface VideoMetadata {
  duration: number
  width: number
  height: number
}

const MAX_CLIPS = 3
const MAX_BYTES = 80 * 1024 * 1024
const MAX_DURATION_SECONDS = 90

function readVideoMetadata(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    let settled = false
    const cleanup = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
    }
    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(`“${file.name}” videosini ochib bo‘lmadi. MP4, MOV yoki WebM faylini sinab ko‘ring.`))
    }, 15_000)
    const finish = () => {
      if (settled) return
      settled = true
      const metadata = { duration: video.duration, width: video.videoWidth, height: video.videoHeight }
      cleanup()
      if (!Number.isFinite(metadata.duration) || metadata.duration <= 0 || !metadata.width || !metadata.height) {
        reject(new Error(`“${file.name}” videosining ma’lumotlarini o‘qib bo‘lmadi.`))
        return
      }
      resolve(metadata)
    }
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration)) {
        finish()
        return
      }
      video.addEventListener('seeked', finish, { once: true })
      try {
        video.currentTime = Number.MAX_SAFE_INTEGER
      } catch {
        finish()
      }
    }
    video.onerror = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(`“${file.name}” formatini bu brauzer ocholmadi. MP4, MOV yoki WebM faylini sinab ko‘ring.`))
    }
    video.src = url
  })
}

function waitForVideo(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve()
  return new Promise((resolve, reject) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true })
    video.addEventListener('error', () => reject(new Error('Video faylini o‘qib bo‘lmadi.')), { once: true })
    video.load()
  })
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.05) return Promise.resolve()
  return new Promise((resolve, reject) => {
    video.addEventListener('seeked', () => resolve(), { once: true })
    video.addEventListener('error', () => reject(new Error('Videodagi tanlangan joyga o‘tib bo‘lmadi.')), { once: true })
    video.currentTime = time
  })
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainder}`
}

function drawFrame(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  title: string,
) {
  const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight)
  const width = video.videoWidth * scale
  const height = video.videoHeight * scale
  const x = (canvas.width - width) / 2
  const y = (canvas.height - height) / 2
  context.fillStyle = '#09090b'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(video, x, y, width, height)

  const text = title.trim()
  if (!text) return
  const fontSize = Math.max(26, Math.round(canvas.width / 26))
  context.font = `600 ${fontSize}px Arial, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (context.measureText(next).width > canvas.width - 96 && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  const visibleLines = lines.slice(0, 2)
  const lineHeight = Math.round(fontSize * 1.3)
  const boxHeight = visibleLines.length * lineHeight + 36
  const boxY = canvas.height - boxHeight - Math.round(canvas.height * 0.08)
  context.fillStyle = 'rgba(0, 0, 0, 0.68)'
  context.fillRect(0, boxY, canvas.width, boxHeight)
  context.fillStyle = '#ffffff'
  visibleLines.forEach((value, index) => {
    context.fillText(value, canvas.width / 2, boxY + 18 + lineHeight * (index + 0.5), canvas.width - 72)
  })
}

function recordingType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find(type => MediaRecorder.isTypeSupported(type))
}

export default function VideoMontageEditor() {
  const [clips, setClips] = useState<Clip[]>([])
  const [music, setMusic] = useState<File | null>(null)
  const [musicVolume, setMusicVolume] = useState(0.3)
  const [title, setTitle] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [outputUrl, setOutputUrl] = useState<string | null>(null)
  const [outputType, setOutputType] = useState('video/mp4')
  const [isLoadingClips, setIsLoadingClips] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [completedClips, setCompletedClips] = useState(0)
  const editorAbort = useRef<AbortController | null>(null)
  const previewVideo = useRef<HTMLVideoElement | null>(null)

  const activeClip = useMemo(
    () => clips.find(clip => clip.id === previewId) ?? clips[0],
    [clips, previewId],
  )
  const totalBytes = clips.reduce((total, clip) => total + clip.file.size, 0)
  const selectedDuration = clips.reduce(
    (total, clip) => total + Math.max(0, clip.trimEnd - clip.trimStart),
    0,
  )

  useEffect(() => {
    const video = previewVideo.current
    if (!activeClip?.file || !video) return
    const url = URL.createObjectURL(activeClip.file)
    video.src = url
    return () => {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
  }, [activeClip?.file])

  useEffect(() => {
    if (!outputUrl) return
    return () => URL.revokeObjectURL(outputUrl)
  }, [outputUrl])

  useEffect(() => () => editorAbort.current?.abort(), [])

  async function addClips(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    setError('')
    setOutputUrl(null)
    if (clips.length + files.length > MAX_CLIPS) {
      setError(`Bir montajga ko‘pi bilan ${MAX_CLIPS} ta video qo‘shish mumkin.`)
      return
    }
    if (totalBytes + files.reduce((total, file) => total + file.size, 0) > MAX_BYTES) {
      setError('Videolarning umumiy hajmi 80 MB dan oshmasin. Qisqaroq yoki kichikroq fayllarni tanlang.')
      return
    }
    setIsLoadingClips(true)
    try {
      const loaded = await Promise.all(files.map(async file => {
        const metadata = await readVideoMetadata(file)
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          ...metadata,
          trimStart: 0,
          trimEnd: metadata.duration,
        }
      }))
      const next = [...clips, ...loaded]
      setClips(next)
      setPreviewId(next[0]?.id ?? null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setIsLoadingClips(false)
    }
  }

  function updateClip(id: string, patch: Partial<Pick<Clip, 'trimStart' | 'trimEnd'>>) {
    setClips(current => current.map(clip => clip.id === id ? { ...clip, ...patch } : clip))
    setOutputUrl(null)
  }

  function moveClip(index: number, direction: -1 | 1) {
    setClips(current => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const reordered = [...current]
      ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
      return reordered
    })
    setOutputUrl(null)
  }

  function removeClip(id: string) {
    const remaining = clips.filter(clip => clip.id !== id)
    setClips(remaining)
    if (previewId === id) setPreviewId(remaining[0]?.id ?? null)
    setOutputUrl(null)
  }

  async function createMontage() {
    if (isEditing || clips.length === 0) return
    setError('')
    setOutputUrl(null)
    const invalidClip = clips.find(clip =>
      !Number.isFinite(clip.trimStart) || !Number.isFinite(clip.trimEnd) ||
      clip.trimStart < 0 || clip.trimEnd > clip.duration || clip.trimEnd <= clip.trimStart,
    )
    if (invalidClip) {
      setError(`“${invalidClip.file.name}” videosining kesish vaqtlarini tekshiring.`)
      return
    }
    if (selectedDuration > MAX_DURATION_SECONDS) {
      setError('Tanlangan videolarning umumiy davomiyligi 90 soniyadan oshmasin.')
      return
    }
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
      setError('Bu brauzerda video eksporti qo‘llab-quvvatlanmaydi. Yangilangan Chrome yoki Safari’da urinib ko‘ring.')
      return
    }
    if (typeof AudioContext === 'undefined') {
      setError('Bu brauzerda audio montaj qo‘llab-quvvatlanmaydi. Yangilangan Chrome yoki Safari’da urinib ko‘ring.')
      return
    }

    const controller = new AbortController()
    editorAbort.current = controller
    let recorder: MediaRecorder | null = null
    let recording: Promise<Blob> | null = null
    let recordingStarted = false
    let canvasStream: MediaStream | null = null
    let audioContext: AudioContext | null = null
    let musicElement: HTMLAudioElement | null = null
    let musicUrl: string | null = null
    let recorderError = ''
    setIsEditing(true)
    setCompletedClips(0)
    setStatus('Montaj vositasi tayyorlanmoqda…')
    try {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Video montaj uchun canvas ishga tushmadi.')
      const firstClip = clips[0]
      const portrait = firstClip.height > firstClip.width
      canvas.width = portrait ? 720 : 1280
      canvas.height = portrait ? 1280 : 720
      canvasStream = canvas.captureStream(30)
      audioContext = new AudioContext()
      await audioContext.resume()
      const audioOutput = audioContext.createMediaStreamDestination()
      const stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioOutput.stream.getAudioTracks(),
      ])
      const mimeType = recordingType()
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 4_000_000,
        audioBitsPerSecond: 128_000,
      })
      const chunks: Blob[] = []
      recording = new Promise(resolve => {
        recorder?.addEventListener('dataavailable', event => {
          if (event.data.size) chunks.push(event.data)
        })
        recorder?.addEventListener('error', () => {
          recorderError = 'Brauzer video yozishni to‘xtatdi. Qisqaroq videolar bilan qayta urinib ko‘ring.'
        })
        recorder?.addEventListener('stop', () => {
          resolve(new Blob(chunks, { type: recorder?.mimeType || mimeType || 'video/webm' }))
        }, { once: true })
      })
      recorder.start(250)
      recordingStarted = true

      if (music) {
        musicUrl = URL.createObjectURL(music)
        musicElement = new Audio(musicUrl)
        musicElement.loop = true
        musicElement.preload = 'auto'
        const musicSource = audioContext.createMediaElementSource(musicElement)
        const musicGain = audioContext.createGain()
        musicGain.gain.value = musicVolume
        musicSource.connect(musicGain)
        musicGain.connect(audioContext.destination)
        musicGain.connect(audioOutput)
        await musicElement.play()
      }

      for (const [index, clip] of clips.entries()) {
        if (controller.signal.aborted) throw new DOMException('Montaj bekor qilindi.', 'AbortError')
        setStatus(`${index + 1}/${clips.length} — ${clip.file.name}`)
        const video = document.createElement('video')
        const clipUrl = URL.createObjectURL(clip.file)
        video.preload = 'auto'
        video.playsInline = true
        video.src = clipUrl
        try {
          await waitForVideo(video)
          await seekVideo(video, clip.trimStart)
          const source = audioContext.createMediaElementSource(video)
          source.connect(audioContext.destination)
          source.connect(audioOutput)
          const end = Math.min(clip.trimEnd, video.duration)
          if (end <= clip.trimStart) throw new Error(`“${clip.file.name}” videosining kesish oralig‘i noto‘g‘ri.`)
          await video.play()
          await new Promise<void>((resolve, reject) => {
            const render = () => {
              if (controller.signal.aborted) {
                video.pause()
                reject(new DOMException('Montaj bekor qilindi.', 'AbortError'))
                return
              }
              drawFrame(context, video, canvas, title)
              if (video.ended || video.currentTime >= end) {
                video.pause()
                resolve()
                return
              }
              window.requestAnimationFrame(render)
            }
            render()
          })
          source.disconnect()
          video.pause()
        } finally {
          video.removeAttribute('src')
          video.load()
          URL.revokeObjectURL(clipUrl)
        }
        setCompletedClips(index + 1)
      }

      if (controller.signal.aborted) throw new DOMException('Montaj bekor qilindi.', 'AbortError')
      if (recorder.state === 'recording') recorder.stop()
      const blob = await recording
      if (recorderError) throw new Error(recorderError)
      if (!blob.size) throw new Error('Tayyor video bo‘sh chiqdi. Qisqaroq videolar bilan qayta urinib ko‘ring.')
      setOutputType(blob.type || 'video/webm')
      setOutputUrl(URL.createObjectURL(blob))
      setStatus('Montaj tayyor.')
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') {
        setStatus('Montaj bekor qilindi.')
      } else {
        setError(reason instanceof Error ? reason.message : String(reason))
        setStatus('')
      }
    } finally {
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      if (recording && recordingStarted) await recording
      canvasStream?.getTracks().forEach(track => track.stop())
      musicElement?.pause()
      musicElement?.removeAttribute('src')
      audioContext?.close().catch(() => undefined)
      if (musicUrl) URL.revokeObjectURL(musicUrl)
      if (editorAbort.current === controller) editorAbort.current = null
      setIsEditing(false)
    }
  }

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <section className="space-y-4 rounded-2xl border bg-card p-5">
        <div>
          <h2 className="text-base font-semibold">Videolarni montaj qilish</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            3 tagacha qisqa videoni kesing, tartiblang, sarlavha va musiqa qo‘shing.
            Fayllar qurilmangizda qayta ishlanadi, serverga yuklanmaydi.
          </p>
        </div>

        <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
          <Scissors className="size-4" aria-hidden="true" />
          {isLoadingClips ? 'Video ochilmoqda…' : 'Video tanlash'}
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/x-m4v"
            multiple
            disabled={isLoadingClips || isEditing}
            onChange={event => void addClips(event)}
            className="sr-only"
          />
        </label>

        {clips.length > 0 && (
          <div className="space-y-3">
            {clips.map((clip, index) => (
              <div key={clip.id} className="rounded-xl border p-3">
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewId(clip.id)}
                    className="min-w-0 flex-1 text-left"
                    aria-label={`${clip.file.name} videosini ko‘rib chiqish`}
                  >
                    <span className="block truncate text-sm font-medium">{index + 1}. {clip.file.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{formatTime(clip.duration)} · {(clip.file.size / 1024 / 1024).toFixed(1)} MB</span>
                  </button>
                  <button type="button" onClick={() => moveClip(index, -1)} disabled={index === 0 || isEditing} aria-label="Videoni oldinga ko‘chirish" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40">
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => moveClip(index, 1)} disabled={index === clips.length - 1 || isEditing} aria-label="Videoni keyinga ko‘chirish" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40">
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => removeClip(clip.id)} disabled={isEditing} aria-label={`${clip.file.name} videosini olib tashlash`} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs text-muted-foreground">
                    Boshlanish (soniya)
                    <input
                      type="number"
                      min="0"
                      max={clip.duration}
                      step="0.1"
                      value={clip.trimStart}
                      disabled={isEditing}
                      onChange={event => updateClip(clip.id, { trimStart: Number(event.target.value) })}
                      className="mt-1 h-10 w-full rounded-lg border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Tugash (soniya)
                    <input
                      type="number"
                      min="0"
                      max={clip.duration}
                      step="0.1"
                      value={clip.trimEnd}
                      disabled={isEditing}
                      onChange={event => updateClip(clip.id, { trimEnd: Number(event.target.value) })}
                      className="mt-1 h-10 w-full rounded-lg border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        <label className="block text-sm font-medium">
          Video ustiga sarlavha (ixtiyoriy)
          <input
            type="text"
            value={title}
            onChange={event => setTitle(event.target.value)}
            maxLength={80}
            disabled={isEditing}
            placeholder="Masalan: Yangi kolleksiyamiz"
            className="mt-1.5 h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          />
        </label>

        <div className="space-y-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium transition hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
            <Music2 className="size-4" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{music ? music.name : 'Fon musiqasi qo‘shish (ixtiyoriy)'}</span>
            <input
              type="file"
              accept="audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/aac,audio/webm"
              disabled={isEditing}
              onChange={event => {
                setMusic(event.target.files?.[0] ?? null)
                event.target.value = ''
                setOutputUrl(null)
              }}
              className="sr-only"
            />
          </label>
          {music && (
            <label className="block text-xs text-muted-foreground">
              Musiqa balandligi
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={musicVolume}
                disabled={isEditing}
                onChange={event => setMusicVolume(Number(event.target.value))}
                className="mt-1 block w-full accent-primary"
              />
            </label>
          )}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Bepul montaj qurilmangizda bajariladi. 3 tagacha video, jami 80 MB va 90 soniyagacha.
          Sahifani ochiq tuting; eksport video davomiyligicha vaqt olishi mumkin.
        </p>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {isEditing && (
          <div className="flex items-center justify-between gap-3" role="status" aria-live="polite">
            <p className="min-w-0 truncate text-sm text-muted-foreground">{status}</p>
            <button type="button" onClick={() => editorAbort.current?.abort()} className="min-h-10 shrink-0 rounded-lg border px-3 text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Bekor qilish
            </button>
          </div>
        )}
        {status === 'Montaj tayyor.' && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
        <button
          type="button"
          onClick={() => void createMontage()}
          disabled={isEditing || isLoadingClips || clips.length === 0 || selectedDuration <= 0}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {isEditing ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Scissors className="size-4" aria-hidden="true" />}
          {isEditing ? 'Montaj tayyorlanmoqda…' : 'Montajni yaratish'}
        </button>
      </section>

      <section aria-label="Montaj ko‘rinishi" className="min-w-0 space-y-3">
        <div className="flex aspect-video items-center justify-center overflow-hidden rounded-2xl border bg-muted/40">
          {outputUrl ? (
            <video src={outputUrl} controls playsInline className="h-full w-full object-contain">
              Brauzeringiz video ijrosini qo‘llab-quvvatlamaydi.
            </video>
          ) : activeClip ? (
            <video key={activeClip.id} ref={previewVideo} controls playsInline className="h-full w-full object-contain">
              Brauzeringiz video ijrosini qo‘llab-quvvatlamaydi.
            </video>
          ) : (
            <div className="px-6 text-center">
              <Scissors className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">Montaj uchun video tanlang</p>
              <p className="mt-1 text-xs text-muted-foreground">Tanlangan kliplar shu yerda ko‘rinadi.</p>
            </div>
          )}
        </div>
        {outputUrl && (
          <a
            href={outputUrl}
            download={`zarnur-montaj.${outputType.includes('mp4') ? 'mp4' : 'webm'}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="size-4" aria-hidden="true" />
            Montajni yuklab olish
          </a>
        )}
        {isEditing && (
          <p className="text-xs text-muted-foreground">
            {completedClips} / {clips.length} klip tayyorlandi. Bu eksport real vaqtda yoziladi.
          </p>
        )}
      </section>
    </div>
  )
}
