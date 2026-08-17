---
name: llm-bridge-chat-guidance
description: 指导浏览器或页面脚本正确使用 LLMBridge.chat() 进行文本推理、JSON 结构化输出，以及图片、视频和音频理解。用于编写、修改或审查调用 LLMBridge 的 JavaScript，尤其适用于多模态输入、媒体格式选择、视频采样率设置、调用合并和限流优化；不用于通过 generateAudio() 或 generateVideo() 生成新媒体。
---

# LLMBridge 对话指南

使用 `LLMBridge.chat()` 完成文本推理、结构化数据生成和现有媒体内容理解。尽量把相关任务合并到一次调用中，避免循环调用和发送无关的大型媒体文件。

## 1. 处理文本对话

直接传入提示词以执行基础文本推理或生成：

```javascript
// 基础文本推理或生成
const response = await LLMBridge.chat("在这里填写提示词");

// JSON 响应模式：需要结构化数据时使用
const result = await LLMBridge.chat("在这里填写提示词", "json");

// JSON 模式的等价对象写法
const result = await LLMBridge.chat("在这里填写提示词", {
  response_format: "json"
});
```

遵守以下限流规则：

- 不要在循环中调用受限流约束的 `LLMBridge.chat()`。
- 尽量将相关推理需求合并为一个结构清晰的提示词。

```javascript
// 避免：为每个项目分别调用
for (const item of items) {
  await LLMBridge.chat(`分析：${item}`);
}

// 推荐：一次分析全部项目并返回结构化结果
await LLMBridge.chat(
  `分析以下所有项目，并返回 JSON 数组：${items.join(", ")}`,
  "json"
);
```

## 2. 理解图片

当脚本需要根据图片内容进行理解、比较、提取或判断时，通过 `images` 传入截图、`<img>` 元素或画布输出。

`images` 数组支持以下格式：

- 公网 URL：`https://example.com/photo.jpg `
- Base64 Data URL：`data:image/png;base64,...` 或 `data:image/jpeg;base64,...`

```javascript
// 分析公网图片 URL
const reply = await LLMBridge.chat("描述这张图片的主体和氛围", {
  images: ["https://example.com/photo.jpg "]
});

// 分析页面中的 <img> 元素；存在公网 http(s) URL 时优先使用 src
const img = document.querySelector("img.hero");
const imageSrc = img?.currentSrc || img?.src;
const reply = await LLMBridge.chat("图片展示了什么产品？上面有哪些文字？", {
  images: [imageSrc]
});

// 没有稳定公网 URL 时，从 canvas 截取并分析
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
canvas.width = img.naturalWidth;
canvas.height = img.naturalHeight;
ctx.drawImage(img, 0, 0);
const dataUrl = canvas.toDataURL("image/png");
const reply = await LLMBridge.chat("总结截图中可见的界面状态", {
  images: [dataUrl]
});

// 从一张或多张图片中提取 JSON
const structured = await LLMBridge.chat(
  "提取标题、价格和库存状态，并返回 JSON",
  {
    response_format: "json",
    images: [imageSrc]
  }
);
```

遵守以下图片处理规则：

- 同时需要 `response_format: "json"` 和 `images` 时，使用对象选项写法，不要使用字符串简写。
- 比较多张图片时，优先在一次调用中传入多张图片，不要逐张调用。
- 仅发送任务必需的图片，避免上传体积较大且无关的截图。
- 如果 `<img>` 使用 `blob:` 或不透明 URL，通过 canvas 转为 Data URL，或改用其他可见图片源。

## 3. 理解视频或音频

通过 `videos` 或 `audios` 理解已有媒体，例如总结视频、识别片段动作、提取时间戳、转写语音、总结会议录音，或回答与音视频内容有关的问题。

不要把媒体理解与媒体生成混淆：`LLMBridge.chat()` 分析已有媒体，`generateAudio()` 和 `generateVideo()` 创建新媒体。

`videos` 数组支持以下格式：

- 公网 URL：`https://example.com/demo.mp4 `
- Base64 Data URL：`data:video/mp4;base64,...`
- 需要控制采样率时使用对象：`{ url: "https://example.com/demo.mp4 ", fps: 1 }`

`audios` 数组支持以下格式：

- 公网 URL：`https://example.com/audio.mp3 `
- Base64 Data URL：`data:audio/mpeg;base64,...`
- 对象：`{ url: audioUrl, format: "mp3" }` 或 `{ data: rawBase64, format: "mp3" }`

```javascript
// 总结公网视频
const summary = await LLMBridge.chat(
  "用 5 个要点总结视频，并说明画面中的动作。",
  {
    videos: [{ url: "https://example.com/demo.mp4 ", fps: 1 }]
  }
);

// 从视频中提取结构化事件
const events = await LLMBridge.chat(
  "返回 JSON 事件列表，每项包含 start_time、end_time、action 和 visible_text。",
  {
    response_format: "json",
    videos: [{ url: videoUrl, fps: 2 }]
  }
);

// 转写或理解音频 URL 中的语音
const transcript = await LLMBridge.chat(
  "逐字转写语音；如果没有语音，则返回空字符串。",
  {
    audios: [{ url: audioUrl, format: "mp3" }]
  }
);

// 将用户选择的本地音频或视频文件转为 Data URL 后分析
const toDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const file = document.querySelector('input[type="file"]')?.files?.[0];
if (file?.type.startsWith("audio/")) {
  const audioDataUrl = await toDataUrl(file);
  const reply = await LLMBridge.chat("总结这段音频。", {
    audios: [audioDataUrl]
  });
  console.log(reply);
} else if (file?.type.startsWith("video/")) {
  const videoDataUrl = await toDataUrl(file);
  const reply = await LLMBridge.chat("描述主要场景和动作。", {
    videos: [{ url: videoDataUrl, fps: 1 }]
  });
  console.log(reply);
}
```

遵守以下音视频处理规则：

- 仅使用 `videos` 理解已有视频，不要用它生成视频。
- 仅使用 `audios` 理解或转写已有音频，不要用它进行文本转语音。
- 同时需要 `response_format: "json"` 和媒体输入时，使用对象选项写法。
- 页面提供稳定媒体地址时，优先使用公网 HTTP(S) URL；用户选择的本地文件或无法用普通 URL 发送的 `blob:` 媒体使用 Data URL。
- 视频默认设置 `fps: 1`；快速变化的动作设置为 `2` 至 `5`；缓慢或静态视频设置为 `0.2` 至 `0.5`，以降低延迟和令牌消耗。
- 音频使用对象写法或原始 Base64 数据时，指定 `format`。常用值包括 `"mp3"`、`"wav"`、`"aac"` 和 `"m4a"`。
- 媒体理解可能耗时更长并受限流约束。只发送必要片段或文件，不要在循环中重复调用，并在一个提示词中一次性说明所有所需输出。

## 4. 完成调用前检查

在交付脚本前确认：

1. 根据任务选择 `images`、`videos` 或 `audios`，不要用错媒体类型。
2. 同时使用媒体输入和 JSON 输出时，采用对象选项写法。
3. 合并可在一次推理中完成的请求，避免循环调用。
4. 仅传入完成任务所需的媒体，并为视频选择合适的 `fps`。
5. 对本地文件或 `blob:` 资源使用 Data URL；对稳定公网资源优先使用 HTTP(S) URL。