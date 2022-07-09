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

const ttl = 86400;

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

  const cachedSite = await env.SITES.get(siteUrl);
  if (cachedSite != null) {
    console.log(`cache hit. key=${siteUrl}`);
    const parseResult = JSON.parse(cachedSite) as ParseResult;
    return render(parseResult, url);
  }

  const siteResponse = await fetch(siteUrl);
  if (siteResponse.body == null) {
    return new Response(`${url} is Not found`);
  }

  const reader = siteResponse.body.getReader();
  const decoder = new TextDecoder();
  let bodyText = ``;
  const readChunk = async ({done, value}) => {
    if (done) {
      return;
    }

    bodyText += decoder.decode(value);
    if (bodyText.includes("<body>")) {
      return;
    }

    const readResult = await reader.read();
    await readChunk(readResult);
  };
  const readResult = await reader.read()
  await readChunk(readResult);

  const parseResult = parseBodyText(bodyText, new URL(siteUrl));
  await env.SITES.put(siteUrl, JSON.stringify(parseResult), {expirationTtl: ttl});
  console.log(`store cache. key=${siteUrl}`);

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
      }
      #embed {
        background-color: white;
        width: 100%;
        max-width: 600px;
        height: 150px;
        display: table;
        border: #ccc 1px solid;
        padding: 8px;
        box-sizing: border-box;
      }
      #embed .row {
        display: table-row;
      }
      #embed .left {
        display: table-cell;
        vertical-align: top;
        padding-right: 8px;
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
        max-width: 480px;
        text-overflow: ellipsis;
        margin-bottom: 1em;
      }
      #embed .thumbnail {
        width: 100px;
        height: 100px;
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
          <div class="site_name">${parseResult.siteName}</div>  
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
  extracted: boolean
  ogp: boolean
};

function parseBodyText(bodyText: string, url: URL): ParseResult {
  // console.log(`parseBodyText. bodyText=${bodyText}`);

  const result: ParseResult = {
    linkUrl: url.toString(),
    siteName: url.host,
    title: "",
    description: "",
    iconUrl: extractIconUrlFromBody(bodyText, url),
    extracted: false,
    ogp: false,
  };
  attachOgpFromBody(bodyText, result);

  if (result.title.length === 0) {
    result.title = extractTitleFromBody(bodyText);
  }
  if (result.description.length === 0) {
    result.description = extractDescriptionFromBody(bodyText);
  }
  if (result.iconUrl.length === 0) {
    result.iconUrl = `${url.protocol}//${url.host}/favicon.ico`;
  }

  return result;
}

const titleRe = new RegExp(`<title>(.*?)</title>`);
function extractTitleFromBody(bodyText: string): string {
  const result = titleRe.exec(bodyText);
  if (result) {
    return result[1];
  }

  return "";
}

const descriptionRe = new RegExp(`<meta name="description" content="(.*?)"\\s*/>`);
function extractDescriptionFromBody(bodyText: string): string {
  const result = descriptionRe.exec(bodyText);
  if (result) {
    return result[1];
  }

  return "";
}

const iconUrlRe = new RegExp(`<link rel="shortcut icon" type=".+" href="(.*?)"/?>`);
function extractIconUrlFromBody(bodyText: string, url: URL): string {
  const result = iconUrlRe.exec(bodyText);
  if (result) {
    const iconUrl = result[1];
    if (iconUrl.match(/^http/)) {
      return iconUrl;
    } else {
      return `${url.protocol}//${url.host}${iconUrl}`;
    }
  }

  return "";
}

const ogSiteNameRe = new RegExp(`<meta property="og:site_name" content="(.*?)"\\s*/>`);
const ogTitleRe = new RegExp(`<meta property="og:title" content="(.*?)"\\s*/>`);
const ogDescriptionRe = new RegExp(`<meta property="og:description" content="(.*?)"\\s*/>`);
const ogImageRe = new RegExp(`<meta property="og:image" content="(.*?)"\\s*/>`);
function attachOgpFromBody(bodyText: string, parseResult: ParseResult) {
  const siteNameResult = ogSiteNameRe.exec(bodyText);
  if (siteNameResult) {
    parseResult.siteName = siteNameResult[1];
  }

  const titleResult = ogTitleRe.exec(bodyText);
  if (titleResult) {
    parseResult.title = titleResult[1];
  }

  const descriptionResult = ogDescriptionRe.exec(bodyText);
  if (descriptionResult) {
    parseResult.description = descriptionResult[1];
  }


  const imageResult = ogImageRe.exec(bodyText);
  if (imageResult) {
    parseResult.thumbnailUrl = imageResult[1];
  }

  if (parseResult.siteName.length > 0 && parseResult.title.length > 0 && parseResult.description.length > 0) {
    parseResult.ogp = true;
    parseResult.extracted = true;
  }
}
