/* Contrast of the rendered page, as opposed to contrast of the palette.
 *
 * contrast.py checks the tokens. This checks what a token actually landed on,
 * which is the half that finds the real bugs: an ink that passes on the page
 * and fails on a badge, an `opacity: .6` that dims text without changing its
 * colour, a color-mix() tint nobody measured.
 *
 * Paste the expression below into any browser console on a served page, or
 * drive it with a headless browser across every route in both themes. It
 * returns the elements whose text is under its WCAG AA threshold.
 */
(() => {
  // Chrome computes color-mix() to `color(srgb r g b / a)` with 0..1
  // components, while rgb()/rgba() use 0..255. Reading one as the other turns
  // a pale tint into near-black.
  const parse = c => {
    const unit = /^color\(/.test(c)
    const n = (c.match(/[\d.]+/g)||[0,0,0]).map(Number)
    const v = unit ? n.slice(0,3).map(x => x * 255) : n.slice(0,3)
    return { rgb: v, a: n.length > 3 ? n[3] : 1 }
  }
  const lum = ([r,g,b]) => { const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b) }
  // Composite every translucent background down the ancestor chain, or a 14%
  // tint reads as a fully opaque colour and the numbers come out nonsense.
  const bgOf = el => {
    const stack = []
    let e = el
    while (e) { const p = parse(getComputedStyle(e).backgroundColor)
      if (p.a > 0) { stack.push(p); if (p.a === 1) break } e = e.parentElement }
    let out = [255,255,255]
    for (let i = stack.length - 1; i >= 0; i--)
      out = out.map((v,j) => v + (stack[i].rgb[j] - v) * stack[i].a)
    return out
  }
  const cumOp = el => { let o=1,e=el; while(e&&e!==document.documentElement){ o*=parseFloat(getComputedStyle(e).opacity)||1; e=e.parentElement } return o }
  const bad = [], seen = new Set()
  document.querySelectorAll('#main *').forEach(el => {
    const txt = [...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join('')
    if (!txt) return
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || el.closest('[hidden]')) return
    const size = parseFloat(cs.fontSize), weight = +cs.fontWeight || 400
    const need = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5
    const fg = parse(cs.color), bg = bgOf(el), o = cumOp(el) * fg.a
    const bl = fg.rgb.map((v,i)=>bg[i]+(v-bg[i])*o)
    const a = lum(bl), b = lum(bg)
    const r = (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)
    if (r < need) {
      const key = el.tagName + '.' + el.className + '|' + Math.round(size)
      if (seen.has(key)) return
      seen.add(key)
      bad.push({ sel: key, r: +r.toFixed(2), need, sample: txt.slice(0,30) })
    }
  })
  return bad.sort((x,y)=>x.r-y.r)
})()
