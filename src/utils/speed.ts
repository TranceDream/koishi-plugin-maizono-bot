import sharp from 'sharp'

/**
 * 调整动图速度（GIF/WebP），支持浮点倍速
 * @param imageUrl 输入图像（URL）
 * @param speed 倍速（>1 更快，<1 更慢）
 * @returns Promise<Buffer>
 */
export async function changeSpeed(imageUrl: string, speed: number): Promise<Buffer> {
  if (speed <= 0) {
    throw new Error('speed 必须大于 0')
  }

  const r = await fetch(imageUrl as any)
  if (!('ok' in r) || !(r as any).ok) {
    const rr: any = r
    throw new Error(`下载失败: ${rr.status} ${rr.statusText}`)
  }
  const inputBuffer = Buffer.from(await (r as any).arrayBuffer())

  const image = sharp(inputBuffer, { animated: true })
  const metadata = await image.metadata()

  const { pages, delay, loop, format } = metadata

  // 静态图 = 无 pages 或 pages=1
  if (!pages || pages <= 1 || !delay) {
    return inputBuffer
  }

  // GIF/WebP 的 delay 单位是 "1/100 秒"
  // 比如 delay = [5,10,15] 表示 0.05s, 0.10s, 0.15s

  // 使用倍速调整 delay：速度越快，delay 越短
  const newDelay = delay.map(d => {
    const nd = d / speed
    // delay 必须是整数且 >= 1，否则会被 sharp 吃掉
    return Math.max(1, Math.round(nd))
  })

  // 拿 raw 像素，原样复用（我们不改像素）
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  const frames = pages
  const imgWidth = info.width
  const totalHeight = info.height
  const channels = info.channels

  const frameHeight = totalHeight / frames

  let out = sharp(data, {
    raw: {
      width: imgWidth,
      height: totalHeight,
      channels,
      pageHeight: frameHeight
    },
    animated: true
  })

  // GIF / WebP：写回 delay / loop
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
    // 其他格式不支持 speed → 原样返回
    return inputBuffer
  }

  return await out.toBuffer()
}
