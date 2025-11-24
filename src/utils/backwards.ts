import sharp from 'sharp'

/**
 * 将动图倒放（反转帧顺序），静态图则原样返回
 * @param imageUrl 输入图像（URL）
 * @returns Promise<Buffer>
 */
export async function makeBackwards(imageUrl: string): Promise<Buffer> {
  const r = await fetch(imageUrl as any)
  if (!('ok' in r) || !(r as any).ok) {
    const rr: any = r
    throw new Error(`下载失败: ${rr.status} ${rr.statusText}`)
  }
  const inputBuffer = Buffer.from(await (r as any).arrayBuffer())
  const image = sharp(inputBuffer, { animated: true })
  const metadata = await image.metadata()

  const { width, height: metaHeight, pages = 1, pageHeight: metaPageHeight, delay, loop, format } = metadata

  // 静态图或拿不到尺寸的，直接返回
  if (!width || !metaHeight || pages <= 1) {
    return inputBuffer
  }

  // 拿 raw 像素数据
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  const frames = pages
  const imgWidth = info.width
  const totalHeight = info.height
  const channels = info.channels

  // 单帧高度
  const frameHeight = pages > 1 ? metaPageHeight || Math.floor(totalHeight / pages) : totalHeight

  const frameSize = imgWidth * frameHeight * channels

  // 新建一个 buffer 用来存放“倒序帧”
  const reversed = new Uint8Array(data.length)

  for (let frame = 0; frame < frames; frame++) {
    const srcOffset = frame * frameSize
    const dstOffset = (frames - 1 - frame) * frameSize

    const slice = data.subarray(srcOffset, srcOffset + frameSize)
    reversed.set(slice, dstOffset)
  }

  // delay 数组跟着帧顺序一起反转（如果有的话）
  const newDelay = delay ? [...delay].reverse() : undefined

  // 重新编码为动图
  let out = sharp(reversed, {
    raw: {
      width: imgWidth,
      height: totalHeight, // = frameHeight * frames
      channels,
      pageHeight: frameHeight
    },
    animated: true
  })

  if (format === 'gif') {
    out = out.gif({
      delay: newDelay,
      loop: typeof loop === 'number' ? loop : 0
    })
  } else if (format === 'webp') {
    out = out.webp({
      delay: newDelay,
      loop: typeof loop === 'number' ? loop : 0
    })
  } else {
    // 其他格式：也可以生成动图（例如 apng），这里简单按原格式输出
    out = out.toFormat(format || 'png')
  }

  return await out.toBuffer()
}
