import re, base64, sys, os
# usage: python3 guide-mobile-build.py <out-dir>  → <out-dir>/guide-mobile.html (staff guide for phones, Arabic + English)
S = sys.argv[1]; HERE = os.path.dirname(os.path.abspath(__file__))
logo = "data:image/png;base64," + base64.b64encode(open(os.path.join(HERE, "../../public/logo-wordmark.png"),"rb").read()).decode()
def body(f):
    s = open(os.path.join(HERE, f)).read()
    b = s[s.index("</helmet>")+9 : s.index("</x-dc>")]
    b = re.sub(r' style="[^"]*"', "", b)
    b = b.replace("/_blob/4e2503d43c0f04bebc30c30846296ce7", logo)
    b = re.sub(r'<svg ', '<svg aria-hidden="true" ', b)
    # the outer fixed-size wrapper becomes the language panel
    b = b.strip()
    assert b.startswith("<div")
    return b[b.index(">")+1 : b.rindex("</div>")]
ar, en = body("Main.dc.html"), body("English.dc.html")
css = r"""
/* One column, phone first: a dark brand band, then the numbered steps as cards, read top to bottom. */
:root{
  --bg:#F3F6F5; --card:#FFFFFF; --ink:#122421; --muted:#55665F; --line:#D3DDD9;
  --brand:#154540; --brand-ink:#FFFFFF; --gold:#DCB96B; --gold-ink:#7A5A16; --chip:#E8EFEC; --chip-ink:#154540;
  --f-display:'Readex Pro','IBM Plex Sans Arabic',system-ui,sans-serif; --f-body:'IBM Plex Sans Arabic','Segoe UI',system-ui,sans-serif;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#0E1917; --card:#16241F; --ink:#E6EEEB; --muted:#9FB1AA; --line:#2A3B36;
  --brand:#0F322E; --brand-ink:#FFFFFF; --gold:#DCB96B; --gold-ink:#E7C97F; --chip:#1F3530; --chip-ink:#CFE3DC; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0E1917; --card:#16241F; --ink:#E6EEEB; --muted:#9FB1AA; --line:#2A3B36;
  --brand:#0F322E; --brand-ink:#FFFFFF; --gold:#DCB96B; --gold-ink:#E7C97F; --chip:#1F3530; --chip-ink:#CFE3DC; color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:var(--f-body);font-size:17px;line-height:1.7}
a{color:var(--gold-ink);font-weight:600;word-break:break-all}
.wrap{max-width:640px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.top{background:var(--brand);border-bottom:4px solid var(--gold);color:var(--brand-ink)}
.top .wrap{padding-block:18px 24px}
.lang{display:flex;justify-content:flex-end;gap:8px;margin-bottom:14px}
.lang button{font:600 15px/1 var(--f-body);color:var(--brand-ink);background:transparent;border:1.5px solid rgba(255,255,255,.35);border-radius:999px;padding:9px 16px;min-height:40px;cursor:pointer}
.lang button[aria-pressed="true"]{background:var(--gold);border-color:var(--gold);color:#154540}
.lang button:focus-visible,.toc a:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
header>div:first-child{display:flex;justify-content:space-between;align-items:center;gap:12px}
header img{height:40px;width:auto}
header>div:first-child>span{font:500 14px/1 var(--f-display);color:var(--gold);border:1.5px solid var(--gold);border-radius:999px;padding:7px 14px;white-space:nowrap}
header h1{font:700 27px/1.3 var(--f-display);margin:18px 0 8px;text-wrap:balance}
header p{margin:0;color:#D5E2DD;font-size:16px}
header>div:last-child{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
header>div:last-child>span{display:inline-flex;align-items:center;gap:6px;background:rgba(0,0,0,.22);border-radius:999px;padding:6px 12px;font-size:14px}
header svg{width:18px;height:18px;flex:none}
.toc{display:flex;gap:8px;overflow-x:auto;padding-block:14px;scrollbar-width:none}
.toc::-webkit-scrollbar{display:none}
.toc a{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:999px;background:var(--card);border:1px solid var(--line);color:var(--ink);font:600 15px/1 var(--f-display);text-decoration:none;word-break:normal;font-variant-numeric:tabular-nums}
main{display:flex;flex-direction:column;gap:14px;padding-bottom:8px}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:12px;scroll-margin-top:12px;min-width:0}
section>div:first-child{display:flex;align-items:center;gap:12px}
section>div:first-child>span:first-child{flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:999px;background:var(--gold);color:#154540;font:700 18px/1 var(--f-display);font-variant-numeric:tabular-nums}
section>div:first-child>span:not(:first-child){margin-inline-start:auto;font-size:13px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 10px;white-space:nowrap}
section h2{margin:0;font:600 20px/1.35 var(--f-display);text-wrap:balance}
section p{margin:0}
section p+p{color:var(--muted);font-size:16px}
section p b{color:var(--ink)}
section>div:not(:first-child){display:flex;flex-wrap:wrap;align-items:center;gap:8px}
section>div:not(:first-child)>span{display:inline-flex;align-items:center;gap:6px;background:var(--chip);color:var(--chip-ink);border:1px solid var(--line);border-radius:10px;padding:6px 12px;font-size:15px;font-weight:500;line-height:1.4}
section>div:not(:first-child)>span[aria-hidden]{background:none;border:0;padding:0;color:var(--gold-ink);font-weight:700}
section>div:not(:first-child)>svg{width:16px;height:16px;color:var(--muted)}
section>div>span svg{width:16px;height:16px;flex:none}
section>div[dir="ltr"]{font:600 16px/1.4 ui-monospace,Menlo,monospace;background:var(--chip);border:1px dashed var(--line);border-radius:10px;padding:10px 12px;letter-spacing:.04em;overflow-x:auto;display:block;white-space:nowrap}
section>div:not(:first-child)>div{display:flex;flex-direction:column;gap:2px;width:100%;background:var(--chip);border-radius:10px;padding:10px 12px}
section>div:not(:first-child)>div b{font-size:15px}
section>div:not(:first-child)>div span{font-size:15px;color:var(--muted)}
footer{display:flex;gap:12px;align-items:flex-start;background:var(--brand);color:var(--brand-ink);border-radius:14px;padding:18px;margin-block:6px 28px}
footer svg{width:26px;height:26px;flex:none;margin-top:2px}
footer div{display:flex;flex-direction:column;gap:4px}
footer b{font:600 18px/1.4 var(--f-display)}
footer span{color:#D5E2DD;font-size:16px}
@media (min-width:700px){body{font-size:18px} header h1{font-size:34px}}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
"""
def panel(lang, html):
    d = "rtl" if lang == "ar" else "ltr"
    # header stays in the band; main and footer go in the page column; a step index sits between them
    h = html[html.index("<header>"):html.index("</header>")+9]
    m = html[html.index("<main>"):html.index("</main>")+7]
    f = html[html.index("<footer>"):html.index("</footer>")+9]
    n = 0
    def sec(mt):
        nonlocal n; n += 1
        return f'<section id="{lang}-{n}">'
    m = re.sub(r"<section>", sec, m)
    toc = "".join(f'<a href="#{lang}-{i}" aria-label="{i}">{i}</a>' for i in range(1, n+1))
    label = "الخطوات" if lang == "ar" else "Steps"
    btns = '<div class="lang" role="group" aria-label="Language"><button type="button" data-l="ar">عربي</button><button type="button" data-l="en">English</button></div>'
    return (f'<div class="panel" lang="{lang}" dir="{d}" id="p-{lang}"{" hidden" if lang=="en" else ""}>'
            f'<div class="top"><div class="wrap">{btns}{h}</div></div>'
            f'<div class="wrap"><nav class="toc" aria-label="{label}">{toc}</nav>{m}{f}</div></div>')
js = r"""
<script>
(function(){
  var panels={ar:document.getElementById('p-ar'),en:document.getElementById('p-en')};
  function show(l){
    if(!panels[l]) l='ar';
    panels.ar.hidden=l!=='ar'; panels.en.hidden=l!=='en';
    document.documentElement.lang=l; document.documentElement.dir=l==='ar'?'rtl':'ltr';
    document.querySelectorAll('.lang button').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.l===l))});
    try{localStorage.setItem('guide.lang',l)}catch(e){}
  }
  document.addEventListener('click',function(e){
    var b=e.target.closest('.lang button'); if(b){show(b.dataset.l);window.scrollTo(0,0);return}
    var a=e.target.closest('.toc a'); if(a){e.preventDefault();var t=document.getElementById(a.getAttribute('href').slice(1)); if(t) t.scrollIntoView({block:'start'})}
  });
  var saved=null; try{saved=localStorage.getItem('guide.lang')}catch(e){}
  show(location.hash==='#en'?'en':location.hash==='#ar'?'ar':(saved||'ar'));
  window.addEventListener('hashchange',function(){ if(location.hash==='#en'||location.hash==='#ar') show(location.hash.slice(1)) });
})();
</script>"""
out = f"""<title>دليل الموظف · نماء</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&amp;family=Readex+Pro:wght@500;600;700&amp;display=swap">
<style>{css}</style>
{panel("ar", ar)}
{panel("en", en)}
{js}
"""
open(os.path.join(S, "guide-mobile.html"),"w").write(out)
print(len(out))
