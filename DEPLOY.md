# Vercel 배포 가이드

## 1. 로컬 터미널에서 GitHub에 푸시

프로젝트 폴더를 터미널에서 열고 아래 순서대로 실행하세요.

```bash
# 프로젝트 폴더로 이동
cd "AI 영상 협업툴/aifilm-collab"

# git 초기화
git init -b main
git add .
git commit -m "feat: initial deploy"

# GitHub 레포와 연결 (YOUR-REPO-URL을 실제 주소로 교체)
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

---

## 2. Vercel에 프로젝트 연결

1. [vercel.com/new](https://vercel.com/new) 접속
2. **"Import Git Repository"** → GitHub 레포 선택
3. Framework Preset: **Next.js** (자동 감지됨)
4. Root Directory: 기본값 유지 (`./`)
5. **"Environment Variables"** 탭에서 아래 변수 입력 (각 이름과 값을 그대로 붙여넣기)

---

## 3. Vercel 환경변수 등록

`.env.local` 파일의 아래 항목들을 Vercel 대시보드에 등록해야 합니다.

| 변수명 | 필수 여부 | 설명 |
|--------|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ 필수 | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ 필수 | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ 필수 | Supabase service role key (서버 전용) |
| `ANTHROPIC_API_KEY` | ✅ 필수 | 씬 분류 / 마스터 프롬프트 |
| `KLING_API_KEY` | ✅ 필수 | I2V 영상 생성 |
| `KLING_API_SECRET` | ✅ 필수 | I2V 영상 생성 |
| `GEMINI_API_KEY` | ✅ 필수 | T2I 이미지 생성 |
| `MIDJOURNEY_API_KEY` | 선택 | Midjourney 사용 시 |
| `MIDJOURNEY_API_URL` | 선택 | Midjourney 사용 시 |

> **팁**: Vercel 대시보드 → Settings → Environment Variables에서 한 번에 여러 개 추가할 수 있습니다.

---

## 4. 배포

환경변수 입력 후 **"Deploy"** 버튼 클릭. 보통 1-2분 내 완료.

완료되면 `https://your-project.vercel.app` 주소가 생성됩니다.

---

## 5. 이후 업데이트

코드를 수정하고 GitHub에 푸시하면 Vercel이 자동으로 재배포합니다.

```bash
git add .
git commit -m "update: 변경사항 설명"
git push
```

---

## Supabase 설정 (팀원 접근 허용)

현재 Supabase Row Level Security(RLS) 설정에 따라 로그인한 사용자만 데이터에 접근할 수 있습니다.
팀원을 추가하려면 Supabase 대시보드 → Authentication → Users에서 팀원 이메일로 초대하세요.
