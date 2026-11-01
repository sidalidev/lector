import puppeteer from 'puppeteer'
import { fileURLToPath } from 'node:url'

const screens = [1, 2, 3, 4]
const W = 393
const H = 852

const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.setViewport({ width: W, height: H, deviceScaleFactor: 3 })

for (const n of screens) {
  await page.goto(`http://localhost:5173/mobile/store-assets/store/mockup.html#${n}`, { waitUntil: 'networkidle0' })
  await page.screenshot({
    path: fileURLToPath(new URL(`./screenshot-${n}.png`, import.meta.url)),
    clip: { x: 0, y: 0, width: W, height: H },
  })
  console.log(`Screenshot ${n} saved`)
}

await browser.close()
console.log('Done!')
