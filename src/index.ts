/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
  // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
  // MY_KV_NAMESPACE: KVNamespace;
  SITES: 'SITES',
  //
  // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
  // MY_DURABLE_OBJECT: DurableObjectNamespace;
  //
  // Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
  // MY_BUCKET: R2Bucket;
  TTL: 'TTL',
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};

async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  if (!url.searchParams.has('url')) {
    return new Response("Please specify url parameter.");
  }

  const siteUrl = url.searchParams.get('url') as string;
  console.log(`siteUrl is ${siteUrl}`);
  if (!siteUrl.match(/^https?:\/\//)) {
    return new Response("Invalid specify url parameter.");
  }

  if (env.TTL > -1) {
    const cachedSite = await env.SITES.get(siteUrl);
    if (cachedSite != null) {
      console.log(`cache hit. key=${siteUrl}`);
      const parseResult = JSON.parse(cachedSite) as ParseResult;
      return render(parseResult, url);
    }
  }

  const siteResponse = await fetch(siteUrl);
  if (siteResponse.body == null) {
    return new Response(`${url} is Not found`);
  }
  console.log(`Site response status=${siteResponse.status}`);

  const parseResult = await parseResponse(siteResponse, new URL(siteUrl));

  if (env.TTL > -1) {
    await env.SITES.put(siteUrl, JSON.stringify(parseResult), {expirationTtl: env.TTL});
    console.log(`store cache. key=${siteUrl}`);
  }

  return render(parseResult, url);
}

function render(parseResult: ParseResult, url: URL): Response {
  if (url.searchParams.get('output') === 'json') {
    // json
    return renderJson(parseResult);
  } else {
    // html
    return renderHtml(parseResult);
  }
}

function renderJson(parseResult: ParseResult): Response {
  return Response.json(parseResult);
}

function renderHtml(parseResult: ParseResult): Response {
  const rightHtml = parseResult.thumbnailUrl ? `
<div class="right">
  <img src="${parseResult.thumbnailUrl}" class="thumbnail" alt="${parseResult.title}" />
</div>
` : "";
  let html = `
<!DOCTYPE html>
<html>
  <head>
    <style>
      * {
        margin: 0;
        padding: 0;
        font-family: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif;
      }
      #embed {
        background-color: white;
        width: 100%;
        height: 150px;
        display: table;
        border: #dedede 1px solid;
        padding: 10px;
        box-sizing: border-box;
      }
      #embed .row {
        display: table-row;
      }
      #embed .left {
        display: table-cell;
        vertical-align: top;
        padding-right: 10px;
      }
      #embed .right {
        display: table-cell;
        vertical-align: top;
        width: 100px;
      }
      #embed .title {
        font-size: large;
        color: #000;
        font-weight: bold;
        margin-bottom: 1em;  
      }
      #embed .description {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        overflow: hidden;
        font-size: small;
        color: #333;
        max-width: calc(100vw - 140px);
        text-overflow: ellipsis;
        margin-bottom: 1em;
      }
      #embed .thumbnail {
        width: 100px;
        height: 100px;
        object-fit: contain;
      }
      #embed .icon {
        width: 16px;
        height: 16px;
        object-fit: contain;
        vertical-align: bottom;
      }
      #embed .site_name {
        color: #333;
        font-size: small;
      }
      a {
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <a href="${parseResult.linkUrl}" target="_blank">
      <div id="embed">
        <div class="row main">
          <div class="left">
            <p class="title">${parseResult.title}</p>  
            <p class="description">${parseResult.description}</p>  
          </div>
          ${rightHtml}
        </div>
        <div class="row meta">
          <div class="site_name">
            <img src="${parseResult.iconUrl}" class="icon" />
            ${parseResult.siteName}
          </div>
        </div>
      </div>
    </a>
  </body>
</html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html;charset=UTF-8',
    }
  });
}

type ParseResult = {
  linkUrl: string
  siteName: string
  title: string
  description: string
  iconUrl: string
  thumbnailUrl?: string
};

async function parseResponse(response: Response, url: URL): Promise<ParseResult> {
  const result: ParseResult = {
    linkUrl: url.toString(),
    siteName: url.host,
    title: "",
    description: "",
    iconUrl: "",
  };

  const newResponse = new HTMLRewriter()
    .on('link', {
      element(element: Element): void | Promise<void> {
        // console.log(`element. tagName=${element.tagName}, rel=${element.getAttribute("rel")}, href=${element.getAttribute("href")}}`);
        if (!element.hasAttribute("rel")) {
          return
        }

        const rel = <string>element.getAttribute("rel");
        if (rel.indexOf('icon') > -1 && result.iconUrl === "") {
          result.iconUrl = toAbsoluteUrl(<string>element.getAttribute("href"), url)
        }
      }
    })
    // .on('meta[property="og:site_name"]', {
    //   element(element: Element): void | Promise<void> {
    //     // console.log(`ogp. property=site_name, content=${element.getAttribute('content')}`);
    //   }
    // })
    // .on('meta[property="og:url"]', {
    //   element(element: Element): void | Promise<void> {
    //     // console.log(`ogp. property=url, content=${element.getAttribute('content')}`);
    //   }
    // })
    .on('meta[property="og:title"]', {
      element(element: Element): void | Promise<void> {
        if (element.hasAttribute('content')) {
          result.title = <string>element.getAttribute('content');
        }
      }
    })
    .on('meta[property="og:image"]', {
      element(element: Element): void | Promise<void> {
        if (element.hasAttribute('content')) {
          result.thumbnailUrl = toAbsoluteUrl(<string>element.getAttribute('content'), url);
        }
      }
    })
    .on('title', {
      text(text: Text): void | Promise<void> {
        if (result.title === "") {
          result.title = text.text;
        }
      }
    })
    .transform(response);
  await newResponse.text();

  if (result.iconUrl === "") {
    result.iconUrl = `${url.protocol}//${url.host}/favicon.ico`;
  }

  return result;
}

function toAbsoluteUrl(resourceUrl: string, siteUrl: URL): string {
  if (resourceUrl.match(/^http/)) {
    return resourceUrl;
  } else {
    return `${siteUrl.protocol}//${siteUrl.host}${resourceUrl}`;
  }
}
