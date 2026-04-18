import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import fs from 'node:fs'

const css = fs.readFileSync('src/app/globals.css', 'utf-8')
try {
  const result = await postcss([tailwind()]).process(css, { from: 'src/app/globals.css' })
  // Look for spacing and font-size references in output
  const out = result.css
  const spacingMatch = out.match(/--spacing:[^;]+/)
  const textXsMatch = out.match(/--text-xs:[^;]+/)
  const fontSize24 = out.includes('font-size: 24px')
  console.log('OK — compiled CSS', out.length, 'bytes')
  console.log('--spacing:', spacingMatch?.[0] ?? 'not found')
  console.log('--text-xs:', textXsMatch?.[0] ?? 'not found (uses default)')
  console.log('html 24px present:', fontSize24)
  // Sample: find a .py-2 class
  const py2 = out.match(/\.py-2\s*\{[^}]+\}/)
  console.log('.py-2 rule:', py2?.[0]?.replace(/\n/g, ' ') ?? 'not used in this css only')
} catch (err) {
  console.error('FAILED:', err.message)
  process.exit(1)
}
