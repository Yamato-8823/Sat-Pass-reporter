function assertSlackOk(payload, method) {
  if (!payload?.ok) {
    const error = payload?.error || "unknown_error";
    throw new Error(`${method} failed: ${error}`);
  }
  return payload;
}

async function slackApi(method, token, body, contentType = "json") {
  const headers = {
    Authorization: `Bearer ${token}`,
  };

  let fetchBody;
  if (contentType === "form") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    fetchBody = new URLSearchParams(body);
  } else {
    headers["Content-Type"] = "application/json; charset=utf-8";
    fetchBody = JSON.stringify(body);
  }

  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers,
    body: fetchBody,
  });

  const payload = await response.json().catch(async () => ({ ok: false, error: await response.text() }));
  if (!response.ok) {
    throw new Error(`${method} HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return assertSlackOk(payload, method);
}

export async function postMessage({ token, channel, text, threadTs }) {
  const payload = await slackApi("chat.postMessage", token, {
    channel,
    text,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
  return payload;
}

export async function uploadFileExternal({ token, channel, threadTs, buffer, filename, title, initialComment }) {
  const upload = await slackApi(
    "files.getUploadURLExternal",
    token,
    {
      filename,
      length: String(buffer.length),
    },
    "form"
  );

  const uploadResponse = await fetch(upload.upload_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(buffer.length),
    },
    body: buffer,
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text().catch(() => "");
    throw new Error(`Slack file binary upload failed HTTP ${uploadResponse.status}: ${text.slice(0, 500)}`);
  }

  const complete = await slackApi("files.completeUploadExternal", token, {
    channel_id: channel,
    thread_ts: threadTs,
    initial_comment: initialComment || "",
    files: [
      {
        id: upload.file_id,
        title: title || filename,
      },
    ],
  });

  return complete;
}
