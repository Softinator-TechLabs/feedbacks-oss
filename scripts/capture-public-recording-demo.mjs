// Photograph the real extension review UI. Only the recording data is synthetic.
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, mkdir } from "node:fs/promises";
import sharp from "sharp";
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "js",
    contents: `
import { createSessionReview } from './extension/session-review.js';
import { createVideoTimeline } from './extension/video/video-timeline.js';
async function mount() {
  document.body.classList.add('has-recording');
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 500;
  const ctx = canvas.getContext('2d');
  const chair = new Image(); chair.src = '/chair.png'; await chair.decode();
  function draw(seconds) {
    ctx.fillStyle = '#f6f4ef'; ctx.fillRect(0,0,1200,500);
    ctx.fillStyle = '#262d26'; ctx.font = 'bold 23px system-ui'; ctx.fillText('GOOD FORM',55,60);
    ctx.font = '16px system-ui'; ctx.fillText('Furniture     Lighting     Objects',690,60);
    ctx.drawImage(chair,55,95,550,345);
    ctx.font = 'bold 32px system-ui'; ctx.fillText('Studio chair',660,155);
    ctx.font = '18px system-ui'; ctx.fillText('A quiet place to land.',660,195); ctx.fillText('$249.00',660,243);
    ctx.fillStyle = seconds >= 4 ? '#f5e0d8' : '#262d26'; ctx.fillRect(660,285,440,60);
    ctx.fillStyle = seconds >= 4 ? '#943619' : '#ffffff'; ctx.font = 'bold 18px system-ui'; ctx.fillText(seconds >= 4 ? 'Unable to place order' : 'Place order',690,323);
    if (seconds >= 4) { ctx.fillStyle = '#943619'; ctx.font = '16px system-ui'; ctx.fillText('Please try again.',660,380); }
    if (seconds >= 2) {ctx.fillStyle='#20241e';ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(985,318);ctx.lineTo(1005,345);ctx.lineTo(990,343);ctx.lineTo(984,359);ctx.closePath();ctx.fill();ctx.stroke();}
  }
  draw(0);
  const stream = canvas.captureStream(12);
  const recorder = new MediaRecorder(stream,{mimeType:'video/webm'}); const chunks=[];
  recorder.ondataavailable=e=>chunks.push(e.data);
  const finished=new Promise(resolve=>recorder.onstop=resolve);
  recorder.start();
  for(let i=0;i<80;i++){draw(i/10);await new Promise(r=>setTimeout(r,100));}
  recorder.stop(); await finished; stream.getTracks().forEach(t=>t.stop());
  const url=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));
  const video=document.querySelector('#preview'); video.src=url;
  await new Promise(r=>video.addEventListener('loadeddata',r,{once:true}));
  for(const id of ['preview','editing','capture-inspector','trim-playback']) document.getElementById(id).hidden=false;
  const timeline=createVideoTimeline({onChange(){},onError(message){throw new Error(message)}});timeline.load(url,8);
  const recording={durationMs:8000,environment:{browser:'Chrome',viewport:{width:1200,height:500}},privacy:{maskInputs:true},events:[
    {seq:0,atMs:2000,type:'activity',data:{action:'click',label:'Place order',selector:'button.checkout',x:985,y:318,button:0}},
    {seq:1,atMs:4000,type:'network',data:{phase:'response',requestId:'checkout-1',method:'POST',url:'https://shop.example/checkout',status:500}},
    {seq:2,atMs:5000,type:'console',data:{level:'error',text:'Checkout request failed',args:['Checkout request failed']}}
  ]};
  createSessionReview(document.querySelector('#capture-inspector'),{videoElement:video,video:{offsetMs:0},recording});
  document.documentElement.dataset.ready='true';
}
mount();`,
  },
  bundle: true,
  write: false,
  format: "iife",
});
const original = await readFile("extension/video.html", "utf8");
const html = original
  .replace(/<script[^>]*><\/script>/g, "")
  .replace("</body>", '<script src="/fixture.js"></script></body>');
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://local").pathname;
    if (path === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    } else if (path === "/fixture.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].text);
    } else if (path === "/chair.png") {
      res.setHeader("Content-Type", "image/png");
      res.end(await readFile("site/public/media/studio-chair.png"));
    } else if (/^\/[a-z-]+\.css$/.test(path)) {
      res.setHeader("Content-Type", "text/css");
      res.end(await readFile("extension" + path));
    } else {
      res.writeHead(404);
      res.end();
    }
  } catch {
    res.writeHead(500);
    res.end();
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const browser = await chromium.launch({ headless: true });
try {
  await mkdir("site/public/media/story", { recursive: true });
  for (const [name, width] of [
    ["desktop", 940],
    ["mobile", 430],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height: 640 },
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator("html[data-ready=true]").waitFor();
    for (const [index, tab, seconds] of [
      [0, "Activity", 2],
      [1, "Network", 4],
      [2, "Console", 5],
    ]) {
      await page.locator(".review-tabs button").filter({ hasText: tab }).click();
      await page.locator("#preview").evaluate((v, time) => {
        v.currentTime = time;
      }, seconds);
      await page.waitForTimeout(300);
      const png = await page.locator(".review-workspace").screenshot();
      await sharp(png)
        .webp({ quality: 90 })
        .toFile(`site/public/media/story/recording-${name}-${index}.webp`);
      console.log(
        name,
        index,
        await sharp(png)
          .metadata()
          .then(({ width, height }) => ({ width, height })),
      );
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  await once(server, "close");
}
