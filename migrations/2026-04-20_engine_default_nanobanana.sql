-- 2026-04-20: scene_settings.engine 기본값을 nanobanana로 변경
-- 기존 'midjourney' 값(= DB default로 삽입됐을 가능성 높음)도 함께 업데이트

alter table public.scene_settings
  alter column engine set default 'nanobanana';

update public.scene_settings
   set engine = 'nanobanana'
 where engine = 'midjourney';
