<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9"
  exclude-result-prefixes="sitemap">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>Yangu Market Stores — Sitemap</title>
        <style>
          :root{color-scheme:light;--green:#17643e;--ink:#17241e;--muted:#65736b;--line:#dfe6e1;--bg:#f4f6f4}
          *{box-sizing:border-box}
          body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
          main{max-width:900px;margin:48px auto;padding:0 20px}
          header,.panel{background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px}
          header{border-top:5px solid var(--green);margin-bottom:20px}
          h1{font-size:clamp(24px,5vw,36px);line-height:1.2;margin:0 0 8px}
          h2{font-size:20px;margin:0 0 14px}
          p{margin:8px 0;color:var(--muted)}
          .count{display:inline-block;margin-top:12px;padding:5px 10px;border-radius:20px;background:#e8f3ec;color:var(--green);font-weight:700}
          .table-wrap{overflow-x:auto}
          table{width:100%;border-collapse:collapse}
          th,td{text-align:left;padding:13px 10px;border-bottom:1px solid var(--line);vertical-align:top}
          th{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.04em}
          a{color:var(--green);overflow-wrap:anywhere}
          .actions{margin-top:20px}
          .button{display:inline-block;padding:10px 14px;border-radius:8px;background:var(--green);color:#fff;text-decoration:none;font-weight:700}
          footer{padding:18px 4px;color:var(--muted);font-size:13px}
          @media(max-width:600px){main{margin:20px auto;padding:0 12px}header,.panel{padding:18px}th,td{padding:10px 7px}}
        </style>
      </head>
      <body>
        <main>
          <header>
            <h1>Yangu Market Stores sitemap</h1>
            <p>This sitemap helps search engines discover the public pages on Yangu Market Stores.</p>
            <span class="count"><xsl:value-of select="count(sitemap:urlset/sitemap:url)"/> URL(s)</span>
          </header>
          <section class="panel">
            <h2>Pages</h2>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Page URL</th><th>Last updated</th></tr></thead>
                <tbody>
                  <xsl:for-each select="sitemap:urlset/sitemap:url">
                    <tr>
                      <td><a><xsl:attribute name="href"><xsl:value-of select="sitemap:loc"/></xsl:attribute><xsl:value-of select="sitemap:loc"/></a></td>
                      <td><xsl:value-of select="sitemap:lastmod"/></td>
                    </tr>
                  </xsl:for-each>
                </tbody>
              </table>
            </div>
            <div class="actions">
              <a class="button" href="https://search.google.com/search-console">Open Google Search Console</a>
            </div>
          </section>
          <footer>The sitemap remains standard XML for search engines. Styling only changes how it appears in a browser.</footer>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
