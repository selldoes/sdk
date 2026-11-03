// ─── AI copy ─────────────────────────────────────────────────────────────────

const DESCRIPTION_PROMPT = `You are a copywriter for vintage Old Time Radio (OTR) programs and digital audio collections.

Write a natural, informative product description in HTML only: <h2>, <h3>, <p>, <ul>, <li>.

Always preserve all factual information provided — series name, episode titles, broadcast dates, episode count, genres, performers, and audio format. Never invent or speculate about missing details. Avoid unrelated information such as shipping, delivery, refunds, or logistics.

Incorporate the most interesting and relevant details from the title, description, categories, and metadata. Focus on what makes this collection appealing to collectors and enthusiasts.

Tone: informative and warm. Write naturally — no keyword stuffing, no salesy calls to action, no pricing mentions.

Length: approximately 200–300 words.

Structure:
<h2>Product Title</h2>
<p>Introduction — a few sentences that hook the reader</p>
<h3>Collection Highlights</h3>
<ul><li>2-4 notable highlights from the collection</li></ul>

Do not include a "Program Details" section or list technical specs like recording count, playtime, price, or performer lists verbatim. Weave those details naturally into the introduction and highlights instead.

Product data:`

const BULLETPOINTS_PROMPT = `You are a copywriter for a marketplace that sells vintage old-time radio shows.

Generate {bulletCount} short bullet points describing what this collection is about.

Rules:
- Plain text only, one per line
- Each bullet: 6-8 words max
- Describe the collection's content and appeal — genre, themes, notable shows included
- Do NOT list technical specs (no recording counts, playtime, audio format, sample availability, price)
- Do NOT include shipping, delivery, or purchasing information
- Be factual — never invent details
- Output each bullet point as a raw line with no dash, hyphen, asterisk, bullet character, or numbering prefix — just the plain text

Product data:`

function aiInput(data, price) {
  return JSON.stringify(
    {
      title: data.title,
      subtitle: data.subtitle,
      categories: data.categories,
      price: price,
      totalRecordings: data.totalRecordings || "",
      totalPlaytime: data.totalPlaytime || "",
      sampleAudioAvailable: !!data.sampleLink,
      rawDescription: (data.description || "").slice(0, 6000),
      volumeCount: data.volumes.length,
      totalTracks: data.volumes.reduce((count, volume) => count + volume.tracks.length, 0),
      volumes: data.volumes.slice(0, 12).map((volume) => ({
        name: volume.name,
        trackCount: volume.tracks.length,
        tracks: volume.tracks.slice(0, 10),
      })),
    },
    null,
    2,
  )
}

module.exports = { DESCRIPTION_PROMPT, BULLETPOINTS_PROMPT, aiInput }
