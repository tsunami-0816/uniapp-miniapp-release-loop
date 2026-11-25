// 首页桌面宽屏取证（第 9 步走查 F-07：hero 可点提示是否破坏 1040 双栏版式）
// 用法：node 09_验收/scripts/shot_index_1440.cjs [stamp]
const path = require('node:path')
const puppeteer = require(path.join(__dirname, '..', '..', '05_代码', 'frontend', 'node_modules', 'puppeteer-core'))
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const OUT = path.join(__dirname, '..', 'evidence')
const STAMP = process.argv[2] || 'shot1440'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--disable-gpu', '--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.goto('http://127.0.0.1:5186/#/pages/index/index', { waitUntil: 'networkidle0', timeout: 40000 })
  await sleep(2500)
  const probe = await page.evaluate(() => {
    const hero = document.querySelector('.hero')
    const photo = document.querySelector('.hero-photo')
    const link = Array.from(document.querySelectorAll('.hero-link'))[0]
    const r = (el) => (el ? el.getBoundingClientRect() : null)
    const box = (b) => (b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null)
    return {
      hero: box(r(hero)),
      photo: box(r(photo)),
      link: box(r(link)),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120)
    }
  })
  await page.screenshot({ path: path.join(OUT, `diag_${STAMP}_index_1440.png`) })
  console.log(JSON.stringify(probe))
  await browser.close()
})().catch((e) => {
  console.error('SHOT_ERROR', e.message)
  process.exit(2)
})
