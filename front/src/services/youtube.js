/**
 * Service YouTube : extraction de transcript via yt-dlp (Electron IPC)
 * Convertit en Markdown pour utilisation dans Lector
 */

// Extrait le videoId d'une URL YouTube
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&\s]+)/,
    /(?:youtu\.be\/)([^?\s]+)/,
    /(?:youtube\.com\/embed\/)([^?\s]+)/,
    /(?:youtube\.com\/shorts\/)([^?\s]+)/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

// Formate les secondes en MM:SS ou HH:MM:SS
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// Parse le XML srv1 de yt-dlp → segments
function parseSubtitleXml(xml) {
  const segments = []
  const regex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g
  let match
  while ((match = regex.exec(xml)) !== null) {
    const start = parseFloat(match[1])
    const text = match[3]
      .replace(/&amp;#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, '')
      .trim()
    if (text) segments.push({ start, text })
  }
  return segments
}

// Convertit des segments en Markdown
function transcriptToMarkdown({ title, videoId, lang, segments }) {
  const url = `https://www.youtube.com/watch?v=${videoId}`
  const lines = []

  lines.push(`# ${title}`)
  lines.push('')
  lines.push(`> Source : [YouTube](${url}) | Langue : ${lang}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  // Regrouper par blocs de ~60 secondes
  let currentBlock = []
  let blockStart = 0

  for (const seg of segments) {
    if (currentBlock.length === 0) blockStart = seg.start
    currentBlock.push(seg.text)

    if (seg.start - blockStart >= 60) {
      lines.push(`**[${formatTime(blockStart)}]** ${currentBlock.join(' ')}`)
      lines.push('')
      currentBlock = []
    }
  }

  if (currentBlock.length) {
    lines.push(`**[${formatTime(blockStart)}]** ${currentBlock.join(' ')}`)
    lines.push('')
  }

  return lines.join('\n')
}

// Fonction principale : URL → Markdown (via yt-dlp dans Electron)
export async function youtubeToMarkdown(url) {
  const videoId = extractVideoId(url)
  if (!videoId) throw new Error('URL YouTube invalide')

  if (!window.electron?.ytDlpTranscript) {
    throw new Error('yt-dlp nécessite l\'app Electron (pas disponible en navigateur)')
  }

  const result = await window.electron.ytDlpTranscript(videoId)

  if (!result.ok) throw new Error(result.error || 'Erreur yt-dlp')

  const segments = parseSubtitleXml(result.xml)
  if (!segments.length) throw new Error('Sous-titres vides')

  const markdown = transcriptToMarkdown({
    title: result.title || `YouTube ${videoId}`,
    videoId,
    lang: result.lang || 'auto',
    segments,
  })

  return {
    content: markdown,
    fileName: `${result.title || videoId}.md`,
    title: result.title || videoId,
    videoId,
  }
}

export { extractVideoId }
