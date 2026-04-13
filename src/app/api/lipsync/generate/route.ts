import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { attemptId, videoUrl, audioUrl, projectId, sceneId } = await req.json()
  const supabase = await createClient()

  try {
    let resultUrl = ''

    // SyncLabs
    const syncRes = await fetch('https://api.synclabs.so/video', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.SYNCLABS_API_KEY!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ videoUrl, audioUrl, synergize: true }),
    })

    if (syncRes.ok) {
      const syncData = await syncRes.json()
      const jobId = syncData.id
      // Poll
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 15000))
        const pollRes = await fetch(`https://api.synclabs.so/video/${jobId}`, {
          headers: { 'x-api-key': process.env.SYNCLABS_API_KEY! }
        })
        const pollData = await pollRes.json()
        if (pollData.status === 'completed') { resultUrl = pollData.url ?? ''; break }
        if (pollData.status === 'failed') break
      }
    }

    if (resultUrl) {
      const { data: asset } = await supabase.from('assets').insert({
        project_id: projectId,
        scene_id: sceneId,
        type: 'lipsync',
        name: `lipsync_${Date.now()}.mp4`,
        url: resultUrl,
        tags: [],
        metadata: { source_video: videoUrl, audio: audioUrl },
        attempt_id: attemptId,
      }).select().single()

      if (asset) {
        await supabase.from('attempt_outputs').insert({ attempt_id: attemptId, asset_id: asset.id })
      }
      await supabase.from('prompt_attempts').update({ status: 'done' }).eq('id', attemptId)
    } else {
      await supabase.from('prompt_attempts').update({ status: 'failed' }).eq('id', attemptId)
    }

    return NextResponse.json({ success: !!resultUrl })

  } catch (err) {
    await supabase.from('prompt_attempts').update({ status: 'failed' }).eq('id', attemptId)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
