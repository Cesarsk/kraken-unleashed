const fs = require('fs');
const path = require('path');

const VT_API_KEY = process.env.VT_API_KEY;
const MAX_INLINE_UPLOAD_BYTES = 32 * 1024 * 1024;

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function vtFetch(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'x-apikey': VT_API_KEY,
      ...(init.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`VirusTotal request failed: ${message}`);
  }

  return payload;
}

async function resolveUploadUrl(fileSize) {
  if (fileSize <= MAX_INLINE_UPLOAD_BYTES) {
    return 'https://www.virustotal.com/api/v3/files';
  }

  const payload = await vtFetch('https://www.virustotal.com/api/v3/files/upload_url');
  return payload.data;
}

function buildGuiUrl(sha256, analysisId) {
  if (sha256) {
    return `https://www.virustotal.com/gui/file/${sha256}`;
  }

  if (analysisId) {
    return `https://www.virustotal.com/gui/file-analysis/${analysisId}`;
  }

  return 'https://www.virustotal.com/gui/home/upload';
}

async function uploadFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const fileName = path.basename(absolutePath);
  const bytes = fs.readFileSync(absolutePath);
  const uploadUrl = await resolveUploadUrl(bytes.length);
  const form = new FormData();
  form.append('file', new Blob([bytes]), fileName);

  const upload = await vtFetch(uploadUrl, {
    method: 'POST',
    body: form
  });
  const analysisId = upload?.data?.id;

  await sleep(15000);
  const analysis = analysisId
    ? await vtFetch(`https://www.virustotal.com/api/v3/analyses/${analysisId}`)
    : null;

  const analysisData = analysis?.data || {};
  const analysisAttributes = analysisData.attributes || {};
  const fileInfo = analysis?.meta?.file_info || {};
  const sha256 = fileInfo.sha256 || null;

  return {
    fileName,
    filePath: absolutePath,
    analysisId: analysisId || null,
    sha256,
    status: analysisAttributes.status || 'queued',
    stats: analysisAttributes.stats || null,
    guiUrl: buildGuiUrl(sha256, analysisId)
  };
}

async function main() {
  if (!VT_API_KEY) {
    throw new Error('VT_API_KEY is required for VirusTotal uploads.');
  }

  const filePaths = process.argv.slice(2);
  if (filePaths.length === 0) {
    throw new Error('Pass at least one packaged artifact path to upload-virustotal.js.');
  }

  const results = [];
  for (const filePath of filePaths) {
    results.push(await uploadFile(filePath));
    await sleep(2000);
  }

  const outputDir = path.join(path.dirname(path.resolve(filePaths[0])), 'virustotal');
  fs.mkdirSync(outputDir, { recursive: true });

  const reportPath = path.join(outputDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

  const summaryLines = ['# VirusTotal', ''];
  for (const result of results) {
    const stats = result.stats
      ? `harmless=${result.stats.harmless || 0}, suspicious=${result.stats.suspicious || 0}, malicious=${result.stats.malicious || 0}, undetected=${result.stats.undetected || 0}`
      : 'stats pending';
    summaryLines.push(`- ${result.fileName}: status=${result.status}; ${stats}; ${result.guiUrl}`);
  }

  const summaryPath = path.join(outputDir, 'summary.md');
  fs.writeFileSync(summaryPath, `${summaryLines.join('\n')}\n`);

  console.log(`VirusTotal report written to ${reportPath}`);
  console.log(`VirusTotal summary written to ${summaryPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
