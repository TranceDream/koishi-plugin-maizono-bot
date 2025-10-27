import sharp from 'sharp'
import GIFEncoder from 'gif-encoder-2'

export type SymmetryMode = 'horizontal-left' | 'horizontal-right' | 'vertical-top' | 'vertical-bottom'

type OutPref = 'auto' | 'png' | 'jpeg' | 'gif'

const clampHalf = (n: number) => Math.max(1, Math.floor(n / 2))

/** 用 sharp 处理一帧：输入 raw RGBA，输出 raw RGBA（不落地、不用 sharp 组装动图） */
async function mirrorFrameRaw(
  raw: Buffer,
  w: number,
  h: number,
  mode: SymmetryMode
): Promise<{ data: Buffer; width: number; height: number }> {
  // 为了确保“对半”不出 0 宽/高，奇数维度时裁掉 1px
  let targetW = w
  let targetH = h
  if (mode.startsWith('horizontal') && targetW % 2 === 1) targetW -= 1
  if (mode.startsWith('vertical') && targetH % 2 === 1) targetH -= 1

  // 把 raw 裁成统一目标尺寸（只在需要时裁 1px）
  const baseBuf =
    targetW === w && targetH === h
      ? raw
      : await sharp(raw, { raw: { width: w, height: h, channels: 4 } })
          .extract({ left: 0, top: 0, width: targetW, height: targetH })
          .raw()
          .toBuffer()

  if (mode.startsWith('horizontal')) {
    const halfW = clampHalf(targetW)
    const isLeft = mode === 'horizontal-left'

    const part = await sharp(baseBuf, {
      raw: { width: targetW, height: targetH, channels: 4 }
    })
      .extract({
        left: isLeft ? 0 : targetW - halfW,
        top: 0,
        width: halfW,
        height: targetH
      })
      .toBuffer()

    const flipped = await sharp(part, {
      raw: { width: halfW, height: targetH, channels: 4 }
    })
      .flop()
      .toBuffer()

    const composed = await sharp({
      create: {
        width: halfW * 2,
        height: targetH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite(
        isLeft
          ? [
              {
                input: part,
                raw: { width: halfW, height: targetH, channels: 4 },
                left: 0,
                top: 0
              },
              {
                input: flipped,
                raw: { width: halfW, height: targetH, channels: 4 },
                left: halfW,
                top: 0
              }
            ]
          : [
              {
                input: flipped,
                raw: { width: halfW, height: targetH, channels: 4 },
                left: 0,
                top: 0
              },
              {
                input: part,
                raw: { width: halfW, height: targetH, channels: 4 },
                left: halfW,
                top: 0
              }
            ]
      )
      .raw()
      .toBuffer({ resolveWithObject: true })

    return {
      data: composed.data,
      width: composed.info.width,
      height: composed.info.height
    }
  } else {
    const halfH = clampHalf(targetH)
    const isTop = mode === 'vertical-top'

    const part = await sharp(baseBuf, {
      raw: { width: targetW, height: targetH, channels: 4 }
    })
      .extract({
        left: 0,
        top: isTop ? 0 : targetH - halfH,
        width: targetW,
        height: halfH
      })
      .toBuffer()

    const flipped = await sharp(part, {
      raw: { width: targetW, height: halfH, channels: 4 }
    })
      .flip()
      .toBuffer()

    const composed = await sharp({
      create: {
        width: targetW,
        height: halfH * 2,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite(
        isTop
          ? [
              {
                input: part,
                raw: { width: targetW, height: halfH, channels: 4 },
                left: 0,
                top: 0
              },
              {
                input: flipped,
                raw: { width: targetW, height: halfH, channels: 4 },
                left: 0,
                top: halfH
              }
            ]
          : [
              {
                input: flipped,
                raw: { width: targetW, height: halfH, channels: 4 },
                left: 0,
                top: 0
              },
              {
                input: part,
                raw: { width: targetW, height: halfH, channels: 4 },
                left: 0,
                top: halfH
              }
            ]
      )
      .raw()
      .toBuffer({ resolveWithObject: true })

    return {
      data: composed.data,
      width: composed.info.width,
      height: composed.info.height
    }
  }
}

/** 用 sharp 解码动图为 raw RGBA 帧（不使用 extractFrame、不堆大画布编码） */
async function decodeFramesRaw(input: Buffer) {
  const base = sharp(input, { animated: true })
  const meta = await base.metadata()
  const pages = Math.max(1, meta.pages ?? 1)
  const width = meta.width ?? 0
  const pageHeight = meta.pageHeight ?? meta.height ?? 0
  if (!width || !pageHeight) throw new Error('无法解析图像尺寸')

  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true })
  if (info.channels !== 4) {
    // 统一转 RGBA
    const rgba = await sharp(input, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return decodeFramesRaw(rgba.data) // 递归一次即可
  }

  const stride = width * pageHeight * 4
  const frames: Buffer[] = []
  for (let i = 0; i < pages; i++) {
    const start = i * stride
    const end = start + stride
    if (end > data.length) break
    // 每帧 raw
    frames.push(data.subarray(start, end))
  }

  // delay：sharp 的 metadata.delay（ms），或默认 40ms
  const delays =
    Array.isArray(meta.delay) && meta.delay.length >= frames.length
      ? meta.delay.slice(0, frames.length)
      : Array(frames.length).fill(40)

  return { frames, width, height: pageHeight, delays, pages }
}

/** 用 gif-encoder-2 把 raw RGBA 帧编码为 GIF（完全不依赖 sharp） */
async function encodeGifFromRaw(framesRaw: Buffer[], w: number, h: number, delaysMs: number[]) {
  const enc = new GIFEncoder(w, h, 'neuquant', true)
  enc.setRepeat(0)
  enc.start() // ✅ 用 start()

  for (let i = 0; i < framesRaw.length; i++) {
    enc.setDelay(delaysMs[i] ?? 40)
    enc.addFrame(framesRaw[i]) // RGBA Buffer (w*h*4)
  }

  enc.finish()
  return Buffer.from(enc.out.getData())
}

/**
 * URL → Buffer
 * - 动图：sharp 解码 + 逐帧 sharp 处理 + gif-encoder-2 组装 GIF
 * - 静图：sharp 处理 + 输出 PNG/JPEG（不使用 sharp 的动图编码）
 */
export async function makeSymmetryFromURL(
  url: string,
  mode: SymmetryMode = 'horizontal-left',
  outPref: OutPref = 'auto'
): Promise<{ buffer: Buffer; contentType: string }> {
  const r = await fetch(url as any)
  if (!('ok' in r) || !(r as any).ok) {
    const rr: any = r
    throw new Error(`下载失败: ${rr.status} ${rr.statusText}`)
  }
  const buf = Buffer.from(await (r as any).arrayBuffer())

  // 先看是不是动图
  const meta = await sharp(buf, { animated: true }).metadata()
  const isAnimated = (meta.pages ?? 1) > 1

  if (isAnimated) {
    // 解码 → 逐帧镜像（raw）→ GIF 组装
    const { frames, width, height, delays } = await decodeFramesRaw(buf)

    // 逐帧处理（raw->raw）
    const mirrored: Buffer[] = []
    let outW = 0,
      outH = 0
    for (const fr of frames) {
      const { data, width: fw, height: fh } = await mirrorFrameRaw(fr, width, height, mode)
      mirrored.push(data)
      outW = fw
      outH = fh // 保持相同尺寸（我们做了偶数裁剪）
    }

    // GIF 65535 限制不再踩：gif-encoder-2 编的是单帧尺寸 outW x outH
    const gifBuf = await encodeGifFromRaw(mirrored, outW, outH, delays)

    return { buffer: gifBuf, contentType: 'image/gif' }
  }

  // 静图：直接用 sharp 做完并输出 PNG/JPEG
  const input = sharp(buf).ensureAlpha()
  const { width = 0, height = 0 } = await input.metadata()

  // 取一帧的 raw
  const raw1 = await input.raw().toBuffer()
  const { data, width: w2, height: h2 } = await mirrorFrameRaw(raw1, width, height, mode)

  if (outPref === 'jpeg') {
    const jpg = await sharp(data, {
      raw: { width: w2, height: h2, channels: 4 }
    })
      .jpeg({ quality: 90 })
      .toBuffer()
    return { buffer: jpg, contentType: 'image/jpeg' }
  }
  // 默认 PNG
  const png = await sharp(data, { raw: { width: w2, height: h2, channels: 4 } })
    .png()
    .toBuffer()
  return { buffer: png, contentType: 'image/png' }
}
