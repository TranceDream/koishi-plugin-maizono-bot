import sharp from 'sharp'

export type SymmetryMode = 'left' | 'right' | 'top' | 'bottom'

/**
 * 将图片按指定模式对称（支持静态图 + 动图）
 * @param imageUrl 输入图像（URL）
 * @param mode 对称模式：left/right/top/bottom
 * @returns Promise<Buffer>
 */
export async function makeSymmetry(imageUrl: string, mode: SymmetryMode): Promise<Buffer> {
  const r = await fetch(imageUrl as any)
  if (!('ok' in r) || !(r as any).ok) {
    const rr: any = r
    throw new Error(`下载失败: ${rr.status} ${rr.statusText}`)
  }
  const inputBuffer = Buffer.from(await (r as any).arrayBuffer())

  const image = sharp(inputBuffer, { animated: true })
  const metadata = await image.metadata()

  const { width, height: metaHeight, pages = 1, pageHeight: metaPageHeight, format, delay, loop } = metadata

  if (!width || !metaHeight) {
    throw new Error('无法获取图片尺寸')
  }

  // 取 RAW 像素，保证多帧 GIF/WebP 可直接操作像素
  const { data, info } = await image
    .ensureAlpha() // 保证 4 通道，兼容性强
    .raw()
    .toBuffer({ resolveWithObject: true })

  const imgWidth = info.width
  const totalHeight = info.height // 所有帧拼接总高度
  const channels = info.channels

  const frames = pages > 1 ? pages : 1

  // 单帧高度（pageHeight 对动图很关键）
  const frameHeight = pages > 1 ? metaPageHeight || Math.floor(totalHeight / pages) : totalHeight

  const frameSize = imgWidth * frameHeight * channels

  // ========== 处理各方向的对称 ==========
  for (let frame = 0; frame < frames; frame++) {
    const frameOffset = frame * frameSize

    for (let y = 0; y < frameHeight; y++) {
      for (let x = 0; x < imgWidth; x++) {
        let srcX = x
        let srcY = y

        if (mode === 'left') {
          // 左复制到右：右侧像素 → 用左侧镜像
          if (x >= imgWidth / 2) {
            srcX = imgWidth - 1 - x
          }
        } else if (mode === 'right') {
          // 右复制到左
          if (x < imgWidth / 2) {
            srcX = imgWidth - 1 - x
          }
        } else if (mode === 'top') {
          // 上复制下
          if (y >= frameHeight / 2) {
            srcY = frameHeight - 1 - y
          }
        } else if (mode === 'bottom') {
          // 下复制上
          if (y < frameHeight / 2) {
            srcY = frameHeight - 1 - y
          }
        }

        const dstIndex = frameOffset + (y * imgWidth + x) * channels
        const srcIndex = frameOffset + (srcY * imgWidth + srcX) * channels

        for (let c = 0; c < channels; c++) {
          data[dstIndex + c] = data[srcIndex + c]
        }
      }
    }
  }

  // 重新编码为原格式（动图保留 animation）
  let out = sharp(data, {
    raw: {
      width: imgWidth,
      height: frameHeight * frames,
      channels,
      pageHeight: frameHeight
    },
    animated: frames > 1
  })

  if (frames > 1 && format === 'gif') {
    // GIF：用原 delay / loop
    out = out.gif({
      loop: typeof loop === 'number' ? loop : 0,
      delay // number[] | undefined，sharp 会自己兜底
    })
  } else if (frames > 1 && format === 'webp') {
    // WebP 动图
    out = out.webp({
      loop: typeof loop === 'number' ? loop : 0,
      delay
    })
  } else {
    // 静态图或其它格式，按原格式输出
    out = out.toFormat(format || 'png')
  }
  const output = await out.toBuffer()

  return output
}
