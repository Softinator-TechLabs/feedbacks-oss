export async function previewDimensions(page) {
  await page.locator("#preview-slot:not([hidden]) img").first().waitFor();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll("#preview-slot img")];
    return (
      images.length > 0 &&
      images.every((image) => image.complete && image.naturalWidth > 0)
    );
  });
  return page.locator("#preview-slot img").evaluateAll((images) => ({
    width: images[0].naturalWidth,
    height: images.reduce((sum, image) => sum + image.naturalHeight, 0),
  }));
}

export async function installReviewFixture(context) {
  const state = { mode: "long" };
  await context.route("https://example.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/missing")
      return route.fulfill({ status: 404, body: "Missing" });
    const height =
      state.mode === "short"
        ? 260
        : state.mode === "tall"
          ? 22000
          : state.mode === "tooLong"
            ? 35000
            : 2100;
    const change =
      state.mode === "changing"
        ? '<script>let size=2100; window.qaTimer=setInterval(()=>{ size=size===2100?2300:2100; document.querySelector("main").style.height=size+"px" },75)</script>'
        : "";
    const clipped =
      state.mode === "clipped"
        ? '<style>html{overflow-x:hidden;scroll-behavior:smooth}body{overflow-x:hidden;position:relative}.wide-carousel{position:absolute;top:100px;width:6000px}</style><div class="wide-carousel"><video></video></div><script>window.qaMotion=setInterval(()=>{document.querySelector("video").dispatchEvent(new Event("resize"));document.querySelector(".wide-carousel").dispatchEvent(new Event("scroll"))},100)</script>'
        : "";
    const hover =
      state.mode === "hover"
        ? '<style>#hover-menu{display:none;position:absolute;top:48px;left:20px;width:320px;padding:20px;background:#eef;border:2px solid #356}#hover-host:hover #hover-menu{display:block}</style><nav id="hover-host" style="position:absolute;top:160px;left:20px;width:420px;height:80px;background:#ddd">About<div id="hover-menu">Research ethics menu</div></nav>'
        : "";
    const blocked =
      state.mode === "selection-blocked"
        ? `<style>:root{user-select:none!important;-webkit-user-select:none!important}body * :not(input):not(textarea){user-select:none!important;-webkit-user-select:none!important}</style><script>for(const type of ['selectstart','mousedown'])document.addEventListener(type,event=>{if(event.target.closest('.blocked-copy'))event.preventDefault()},true)</script><p class="blocked-copy" id="inline-blocked" style="user-select:none!important">Selection blocked by inline styles</p><p><span class="blocked-copy" id="boxless-blocked" style="display:contents">Boxless blocked text</span></p><input aria-label="Editable control"><button id="normal-control" onclick="this.dataset.clicked='yes'">Normal control</button>`
        : "";
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>Feedback fixture</title><style>body{margin:0;font:16px sans-serif}header{position:sticky;top:0;background:#eee;padding:16px}main{height:${height}px;padding:16px;position:relative}#lower{position:absolute;top:${Math.max(160, height - 260)}px;left:30px}</style><header>Sticky header</header><main><h1 class="blocked-copy">Controlled page</h1><img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs" /><a href="/missing">Broken same-origin link</a>${hover}${blocked}<button id="lower">Bottom action</button></main>${change}${clipped}`,
    });
  });
  return state;
}
