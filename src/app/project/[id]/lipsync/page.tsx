'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'
import { Loader2, Upload, ChevronRight } from 'lucide-react'
import AttemptTree from '@/components/prompt/AttemptTree'
import type { PromptAttempt, SatisfactionScore } from '@/types'
import Link from 'next/link'
import Badge from '@/components/ui/Badge'

export default function LipsyncPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [videos, setVideos] = useState<any[]>([])
  const [attempts, setAttempts] = useState<Record<string, PromptAttempt[]>>({})
  const [audioFiles, setAudioFiles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    fetchData()
    const attemptChannel = supabase
      .channel(`lipsync-attempts-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prompt_attempts' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attempt_outputs' }, () => fetchData())
      .subscribe()
    const assetChannel = supabase
      .channel(`lipsync-assets-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets', filter: `project_id=eq.${projectId}` }, () => fetchData())
      .subscribe()
    return () => {
      supabase.removeChannel(attemptChannel)
      supabase.removeChannel(assetChannel)
    }
  }, [projectId])

  async function fetchData() {
    const { data: videoAssets } = await supabase
      .from('assets').select('*').eq('project_id', projectId)
      .in('type', ['i2v']).eq('archived', true).order('created_at', { ascending: false })
    setVideos(videoAssets ?? [])
    setLoading(false)
  }

  async function uploadAudio(videoId: string, file: File) {
    setUploading(true)
    const path = `${projectId}/audio/${Date.now()}.${file.name.split('.').pop()}`
    const { data } = await supabase.storage.from('assets').upload(path, file)
    if (data) {
      const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(path)
      setAudioFiles(prev => ({ ...prev, [videoId]: publicUrl }))
    }
    setUploading(false)
  }

  async function newAttempt(sceneId: string, prompt: string, parentId?: string) {
    const audioUrl = audioFiles[sceneId]
    const videoAsset = videos.find(v => v.id === sceneId)

    const { data: attempt } = await supabase.from('prompt_attempts').insert({
      scene_id: sceneId, parent_id: parentId ?? null,
      type: 'lipsync', prompt, engine: 'synclabs',
      status: 'generating', depth: parentId ? 1 : 0,
    }).select().single()

    if (attempt) {
      await fetch('/api/lipsync/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id, videoUrl: videoAsset?.url, audioUrl, projectId, sceneId }),
      })
      fetchData()
    }
  }

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 size={24} className="animate-spin" /></div>

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between" style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--line)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 3 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>립싱크</h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>영상에 음성을 합성하세요</p>
        </div>
        <Link
          href={`/project/${projectId}/archive`}
          className="flex items-center gap-2 transition-all"
          style={{
            padding: '7px 14px',
            borderRadius: 'var(--r-md)',
            fontSize: 13, fontWeight: 500,
            background: 'var(--accent)', color: '#fff',
            border: '1px solid var(--accent)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent-2)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-2)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
        >
          아카이브 <ChevronRight size={15} />
        </Link>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {videos.length === 0 ? (
            <div className="empty" style={{ maxWidth: 480, margin: '64px auto' }}>
              <p style={{ fontSize: 14, color: 'var(--ink-3)', marginBottom: 6 }}>아카이빙된 I2V 영상이 없어요</p>
              <p style={{ fontSize: 12, color: 'var(--ink-4)' }}>I2V 단계에서 영상을 아카이빙하면 여기에 나타납니다</p>
            </div>
          ) : (
            videos.map(video => (
              <div
                key={video.id}
                className="overflow-hidden transition-shadow"
                style={{ borderRadius: 'var(--r-lg)', border: '1px solid var(--line)', background: 'var(--bg-2)' }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
              >
                <div className="p-4" style={{ background: 'var(--bg-1)' }}>
                  <div className="flex items-center gap-3 mb-3">
                    <Badge variant="accent">영상</Badge>
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{video.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <video src={video.url} className="w-32 h-20 object-cover rounded-lg" controls muted />
                    <div className="flex-1">
                      <label className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer w-fit"
                        style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                        <Upload size={14} />
                        {uploading ? '업로드중...' : audioFiles[video.id] ? '✓ 음성 업로드됨' : '음성 파일 업로드 (MP3/WAV)'}
                        <input type="file" accept="audio/*" className="hidden"
                          onChange={e => e.target.files?.[0] && uploadAudio(video.id, e.target.files[0])} />
                      </label>
                    </div>
                  </div>
                </div>
                <div className="p-4 border-t" style={{ borderColor: 'var(--border)', background: 'var(--background)' }}>
                  <AttemptTree sceneId={video.id} attempts={attempts[video.id] ?? []} type="lipsync"
                    onNewAttempt={newAttempt}
                    onScore={async () => {}} onArchive={async () => {}} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
