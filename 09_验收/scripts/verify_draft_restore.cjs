// 第 9 步走查 Q-043 复现/复验：未登录填表 → 跳登录 → 回跳后内容是否保留
// 只读：不真提交订单（登录用页面内 fetch，等同登录成功态）
// 用法：node 09_验收/scripts/verify_draft_restore.cjs [stamp]
const path = require('node:path')
const puppeteer = require(path.join(__dirname, '..', '..', '05_代码', 'frontend', 'node_modules', 'puppeteer-core'))
const fs = require('node:fs')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5186'
const OUT = path.join(__dirname, '..', 'evidence')
const STAMP = process.argv[2] || '20261126_draft'
const FORM = '/#/pages/booking/form?packageId=2&title=' + encodeURIComponent('复古胶片') + '&price=499'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--disable-gpu', '--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 })
  const out = { stamp: STAMP, steps: {}, consoleErrors: [], failed: [] }
  page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(m.text()) })
  page.on('requestfailed', (r) => out.failed.push({ url: r.url(), err: r.failure() && r.failure().errorText }))

  // 0) 清掉登录态与草稿
  await page.goto(BASE + FORM, { waitUntil: 'networkidle0', timeout: 40000 })
  await sleep(800)
  await page.evaluate(() => { localStorage.removeItem('ub_token'); localStorage.removeItem('ub_user'); localStorage.removeItem('ub_booking_draft') })

  // 1) 重新进表单，按未登录用户的方式填写（日期用 picker 难自动化，这里验时段/手机号/备注）
  await page.goto(BASE + FORM, { waitUntil: 'networkidle0', timeout: 40000 })
  await sleep(1800)
  // 日期：点开 uni picker 直接按「确定」（默认落在今天），否则 validate 会先拦下、走不到登录跳转
  await page.evaluate(() => {
    const c = document.querySelector('.form .field .control')
    if (c) c.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(800)
  await page.evaluate(() => {
    const ok = Array.from(document.querySelectorAll('*'))
      .filter((el) => el.children.length === 0 && /^(确定|完成|OK)$/.test((el.textContent || '').trim()))
      .pop()
    if (ok) ok.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(600)
  await page.evaluate(() => {
    const slot = Array.from(document.querySelectorAll('.slot')).find((el) => (el.textContent || '').trim() === '下午')
    if (slot) slot.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(300)
  const input = await page.$('input.uni-input-input')
  await input.click({ clickCount: 3 })
  await input.type('13900000003')
  const area = await page.$('textarea.uni-textarea-textarea')
  await area.click({ clickCount: 3 })
  await area.type('测试草稿内容，登录后应保留')
  await sleep(300)
  out.steps.filled = await page.evaluate(() => ({
    dateText: (document.querySelectorAll('.form .field .control')[0]?.textContent || '').trim(),
    slotActive: (document.querySelector('.slot.active')?.textContent || '').trim(),
    contact: document.querySelector('input.uni-input-input')?.value || '',
    remark: document.querySelector('textarea.uni-textarea-textarea')?.value || ''
  }))
  await page.screenshot({ path: path.join(OUT, `diag_${STAMP}_form_filled_loggedout.png`) })

  // 2) 提交 → 应跳登录，并把草稿落到本地
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.submit')).find((el) => (el.textContent || '').indexOf('确认这一档') >= 0)
    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(1600)
  out.steps.afterSubmit = await page.evaluate(() => {
    const raw = localStorage.getItem('ub_booking_draft')
    let draft = null
    try { draft = raw ? JSON.parse(raw) : null } catch { draft = null }
    // uni-h5 的 storage 包了一层 {type,data}
    if (draft && draft.data) draft = draft.data
    return { hash: location.hash, draft }
  })
  await page.screenshot({ path: path.join(OUT, `diag_${STAMP}_login_page.png`) })

  // 3) 走真实登录页：真人一样敲口令 → 点登录 → 由 afterLogin 自己 redirectTo 回表单
  const pw = await page.$('input[type=password]')
  if (pw) {
    await pw.click()
    await page.type('input[type=password]', 'welcome1', { delay: 80 })
  }
  await sleep(300)
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((el) => /^登录$/.test((el.textContent || '').trim()))
    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(3000)
  out.steps.afterLogin = await page.evaluate(() => ({ hash: location.hash, hasToken: !!localStorage.getItem('ub_token') }))
  await page.screenshot({ path: path.join(OUT, `diag_${STAMP}_after_login.png`) })

  // 3.1) 若真实登录没回跳到表单（例如口令没进 Vue），退一步按登录页同样的 decode 规则手工回跳
  let backUrl = ''
  if (out.steps.afterLogin.hash.indexOf('/pages/booking/form') < 0) {
    const enc = await page.evaluate(async () => {
      const r = await fetch('http://127.0.0.1:8092/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: 'demo', password: 'welcome1' })
      })
      const body = await r.json()
      if (body.code !== 0 || !body.data) return ''
      const wrap = (v, t) => JSON.stringify({ type: t, data: v })
      localStorage.setItem('ub_token', wrap(body.data.token, 'string'))
      localStorage.setItem('ub_user', wrap({ userId: body.data.userId, nickname: body.data.nickname }, 'object'))
      const m = location.hash.match(/redirect=([^&\s]+)/)
      return m ? m[1] : ''
    })
    if (!enc) throw new Error('登录页没有拿到 redirect 参数')
    // 登录页 onLoad 里 decodeURIComponent 一次，这里补上同样的两次解码（URL 本身已有一次编码）
    backUrl = decodeURIComponent(decodeURIComponent(enc))
  } else {
    backUrl = ''
  }
  out.steps.redirect = backUrl

  // 4) 回跳：真实登录已回跳时无需再动；否则按同一目标地址 goto，再 reload 强制新挂载（避免同路由复用掩盖 onLoad）
  if (backUrl) {
    await page.goto(BASE + '/#' + backUrl.replace(/^\//, ''), { waitUntil: 'networkidle0', timeout: 40000 })
    await sleep(1200)
    await page.reload({ waitUntil: 'networkidle0', timeout: 40000 })
  }
  await sleep(2200)
  out.steps.restored = await page.evaluate(() => ({
    hash: location.hash,
    slotActive: (document.querySelector('.slot.active')?.textContent || '').trim(),
    contact: document.querySelector('input.uni-input-input')?.value || '',
    remark: document.querySelector('textarea.uni-textarea-textarea')?.value || '',
    draftLeft: localStorage.getItem('ub_booking_draft'),
    pkgText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 80)
  }))
  await page.screenshot({ path: path.join(OUT, `diag_${STAMP}_form_restored.png`) })

  const r = out.steps.restored
  out.pass = {
    slot: r.slotActive === '下午',
    contact: r.contact === '13900000003',
    remark: r.remark === '测试草稿内容，登录后应保留',
    draftCleared: r.draftLeft === null
  }
  out.allPass = Object.values(out.pass).every(Boolean)
  out.summary = { consoleErrors: out.consoleErrors.length, failed: out.failed.length }
  fs.writeFileSync(path.join(OUT, `verify_draft_${STAMP}.json`), JSON.stringify(out, null, 2))
  console.log(JSON.stringify({ allPass: out.allPass, pass: out.pass, afterLogin: out.steps.afterLogin, redirect: out.steps.redirect, filled: out.steps.filled, afterSubmit: out.steps.afterSubmit, restored: out.steps.restored }))
  await browser.close()
  if (!out.allPass) process.exit(1)
})().catch((e) => {
  console.error('DRAFT_ERROR', e.message)
  process.exit(2)
})
