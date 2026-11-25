// 第 9 步走查反馈复现（2026-11-25）：UI 级登录 → 我的 → 表单提交，抓网络失败根因
// 只读为主：默认不提交订单；传 --submit 才真提交（会动库，需随后重置基线）
// 用法：node 09_验收/scripts/diagnose_step9_ui.cjs [20261125_r3] [--submit]
const fs = require('node:fs')
const path = require('node:path')
const puppeteer = require(path.join(__dirname, '..', '..', '05_代码', 'frontend', 'node_modules', 'puppeteer-core'))

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5186'
const OUT = path.join(__dirname, '..', 'evidence')
const STAMP = process.argv[2] || '20261125_diag'
const DO_SUBMIT = process.argv.indexOf('--submit') >= 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const out = {
  stamp: STAMP,
  startedAt: new Date().toISOString(),
  consoleErrors: [],
  pageErrors: [],
  apiRequests: [],
  failedRequests: [],
  httpErrors: [],
  steps: {}
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--disable-gpu', '--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 })

  page.on('pageerror', (e) => out.pageErrors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(m.text()) })
  page.on('requestfailed', (r) => {
    out.failedRequests.push({ url: r.url(), method: r.method(), errorText: r.failure() && r.failure().errorText })
  })
  page.on('response', (r) => {
    const u = r.url()
    if (u.indexOf('8092') >= 0 || u.indexOf('8093') >= 0) {
      out.apiRequests.push({ url: u, method: r.request().method(), status: r.status() })
      if (r.status() >= 400) out.httpErrors.push({ url: u, status: r.status() })
    }
  })
  page.on('request', (r) => {
    if (r.url().indexOf('/api/auth/login') >= 0) {
      out.loginPayload = r.postData() || ''
    }
  })

  // 1) 先在页面源内调登录接口，再按 uni-h5 的存储结构写入会话（等价于登录成功后的状态）
  await page.goto(BASE + '/#/pages/login/index', { waitUntil: 'networkidle0', timeout: 40000 })
  await sleep(1000)
  out.steps.loginApi = await page.evaluate(async () => {
    const r = await fetch('http://127.0.0.1:8092/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'demo', password: 'welcome1' })
    })
    const body = await r.json()
    if (body.code === 0 && body.data) {
      const wrap = (v, type) => JSON.stringify({ type, data: v })
      localStorage.setItem('ub_token', wrap(body.data.token, 'string'))
      localStorage.setItem('ub_user', wrap({ userId: body.data.userId, nickname: body.data.nickname }, 'object'))
    }
    return { status: r.status, code: body.code, msg: body.msg, userId: body.data && body.data.userId }
  })
  out.steps.afterLogin = {
    storageKeys: await page.evaluate(() => Object.keys(localStorage))
  }
  await page.screenshot({ path: path.join(OUT, `diag_${STAMP}_after_login.png`) })

  // 2) 我的：看列表/错误
  await page.goto(BASE + '/#/pages/my/index', { waitUntil: 'networkidle0', timeout: 40000 })
  await sleep(3500)
  out.steps.myPage = await page.evaluate(() => ({
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    bookings: document.querySelectorAll('.booking').length
  }))
  await page.screenshot({ path: path.join(OUT, `diag_${STAMP}_my.png`) })

  // 3) 详情页：图位是否有真实图片
  await page.goto(BASE + '/#/pages/package/detail?id=2', { waitUntil: 'networkidle0', timeout: 40000 })
  await sleep(2500)
  out.steps.detail = await page.evaluate(() => ({
    title: (document.querySelector('h1')?.textContent || '').trim(),
    photoEl: !!document.querySelector('.photo'),
    imgs: Array.from(document.querySelectorAll('img')).map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth })),
    backLink: Array.from(document.querySelectorAll('*'))
      .filter((el) => el.children.length === 0)
      .some((el) => (el.textContent || '').indexOf('返回') >= 0)
  }))
  await page.screenshot({ path: path.join(OUT, `diag_${STAMP}_detail.png`) })

  // 3.2) 首页首档大图（hero）是否可点：走查 F-07（首档看着不能约）
  await page.goto(BASE + '/#/pages/index/index', { waitUntil: 'networkidle0', timeout: 40000 })
  await sleep(2500)
  out.steps.indexHero = await page.evaluate(() => {
    const text = (document.body.innerText || '').replace(/\s+/g, ' ')
    const hero = document.querySelector('.hero')
    const imgs = Array.from(document.querySelectorAll('.hero img')).map((i) => ({
      src: i.getAttribute('src'),
      w: i.naturalWidth
    }))
    return { hasLinkText: text.indexOf('查看这一档') >= 0, heroEl: !!hero, imgs, text: text.slice(0, 160) }
  })
  await page.screenshot({ path: path.join(OUT, `diag_${STAMP}_index.png`) })
  await page.click('.hero')
  await sleep(1800)
  out.steps.indexHeroClick = await page.evaluate(() => ({
    hash: location.hash,
    title: (document.querySelector('h1')?.textContent || '').trim(),
    hasBack: Array.from(document.querySelectorAll('*'))
      .filter((el) => el.children.length === 0)
      .some((el) => (el.textContent || '').indexOf('返回') >= 0)
  }))
  await page.screenshot({ path: path.join(OUT, `diag_${STAMP}_index_after_hero_tap.png`) })

  // 3.5) 预约表单页：返回入口 / 是否有"网络不稳定" / 提交按钮；另拍桌面宽屏版式
  const formProbe = async () =>
    page.evaluate(() => {
      const text = (document.body.innerText || '').replace(/\s+/g, ' ')
      const leaf = Array.from(document.querySelectorAll('*')).filter((el) => el.children.length === 0)
      return {
        text: text.slice(0, 300),
        hasBack: leaf.some((el) => (el.textContent || '').indexOf('返回') >= 0),
        networkError: text.indexOf('网络不稳定') >= 0,
        hasSubmit: leaf.some((el) => (el.textContent || '').trim() === '确认这一档')
      }
    })
  await page.goto(BASE + '/#/pages/booking/form?packageId=2', { waitUntil: 'networkidle0', timeout: 40000 })
  await sleep(2500)
  out.steps.form375 = await formProbe()
  await page.screenshot({ path: path.join(OUT, `diag_${STAMP}_form_375.png`) })

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.goto(BASE + '/#/pages/booking/form?packageId=2', { waitUntil: 'networkidle0', timeout: 40000 })
  await sleep(2000)
  out.steps.form1440 = await formProbe()
  await page.screenshot({ path: path.join(OUT, `diag_${STAMP}_form_1440.png`) })
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 })

  // 4) 浏览器侧直接调接口：确认 CORS / 401 / 业务错误是否都能被读到（POST 用非法时段，不写库）
  out.steps.fetchProbe = await page.evaluate(async () => {
    const raw = Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])
    let token = ''
    raw.forEach(([, v]) => {
      const m = String(v || '').match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)
      if (m) token = m[0]
    })
    const t = { startedAt: Date.now(), hasToken: !!token }
    try {
      const r = await fetch('http://127.0.0.1:8092/api/bookings?page=1&size=20', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
      t.getStatus = r.status
      t.getBody = (await r.text()).slice(0, 200)
    } catch (e) {
      t.getError = String(e)
    }
    try {
      const r2 = await fetch('http://127.0.0.1:8092/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({ packageId: 1, bookDate: '2026-11-28', slot: '', contact: '13800138000' })
      })
      t.postStatus = r2.status
      t.postBody = (await r2.text()).slice(0, 200)
    } catch (e) {
      t.postError = String(e)
    }
    t.elapsedMs = Date.now() - t.startedAt
    t.storageKeys = raw.map(([k]) => k)
    return t
  })

  // 5) 过期/无效 token 下"我的"页：应提示登录过期并清会话，而不是只报"网络不稳定"
  await page.evaluate(() => {
    const wrap = (v) => JSON.stringify({ type: 'string', data: v })
    // 结构合法但签名无效的 JWT，等价于登录态失效
    localStorage.setItem('ub_token', wrap('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwiZXhwIjoxNjAwMDAwMDAwfQ.sig'))
  })
  await page.goto(BASE + '/#/pages/my/index', { waitUntil: 'networkidle0', timeout: 40000 })
  await sleep(3500)
  out.steps.myWithStaleToken = await page.evaluate(() => {
    const text = (document.body.innerText || '').replace(/\s+/g, ' ')
    return {
      text: text.slice(0, 260),
      hasLoginBtn: text.indexOf('去登录') >= 0,
      tokenCleared: localStorage.getItem('ub_token') === null,
      networkError: text.indexOf('网络不稳定') >= 0
    }
  })
  await page.screenshot({ path: path.join(OUT, `diag_${STAMP}_my_stale_token.png`) })

  out.finishedAt = new Date().toISOString()
  out.summary = {
    consoleErrors: out.consoleErrors.length,
    pageErrors: out.pageErrors.length,
    failedRequests: out.failedRequests.length,
    httpErrors: out.httpErrors.length,
    myBookings: out.steps.myPage && out.steps.myPage.bookings
  }
  fs.writeFileSync(path.join(OUT, `diagnose_${STAMP}.json`), JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out.summary))
  console.log('FAILED', JSON.stringify(out.failedRequests))
  console.log('HTTP', JSON.stringify(out.httpErrors))
  console.log('FETCH', JSON.stringify(out.steps.fetchProbe))
  console.log('MY', JSON.stringify(out.steps.myPage))
  console.log('DETAIL', JSON.stringify(out.steps.detail))
  console.log('HERO', JSON.stringify(out.steps.indexHero), JSON.stringify(out.steps.indexHeroClick))
  console.log('FORM375', JSON.stringify(out.steps.form375))
  console.log('FORM1440', JSON.stringify(out.steps.form1440))
  console.log('STALE', JSON.stringify(out.steps.myWithStaleToken))
  console.log('LOGIN_PAYLOAD', JSON.stringify(out.loginPayload))
  await browser.close()
}

main().catch((e) => { console.error('DIAG_ERROR', e.message); process.exit(2) })
