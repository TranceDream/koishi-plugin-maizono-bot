import sharp from 'sharp'

/**
 * 调整动图速度（GIF/WebP），支持浮点倍速。
 * - speed > 1 加速（必要时会合并小帧，防止 delay 太小被抹平）
 * - speed < 1 减速（仅放大 delay）
 * - 静态图 / 不支持的格式：原样返回
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

  // 静态图 或 没有 delay 信息 → 不处理
  if (!pages || pages <= 1 || !delay || delay.length === 0) {
    return inputBuffer
  }

  // 只对 GIF/WebP 动图做处理，其他格式原样返回
  if (format !== 'gif' && format !== 'webp') {
    return inputBuffer
  }

  // === 时间轴 & 新 delay 计算 ===

  // GIF/WebP delay 单位是 1/100 秒
  const originalDelay = delay.slice() // 拷一份

  // 最小帧间隔，避免太小被浏览器当成 0 或统一成更大的值
  const MIN_DELAY = 2 // 2 * 10ms = 20ms

  let newFrameIndices: number[] = []
  let newDelays: number[] = []

  if (speed <= 1) {
    // 🐢 慢放：只放大 delay 即可，不丢帧
    newFrameIndices = originalDelay.map((_, i) => i)
    newDelays = originalDelay.map(d => Math.max(1, Math.round(d / speed)))
  } else {
    // 🚀 加速：缩短 delay，同时避免过小的 delay，通过“合并帧”来处理
    let pendingIndex = 0 // 当前累积到的输出帧索引（原帧编号）
    let pendingDelay = 0

    for (let i = 0; i < originalDelay.length; i++) {
      const scaled = originalDelay[i] / speed
      pendingDelay += scaled

      if (pendingDelay >= MIN_DELAY || newFrameIndices.length === 0) {
        // 一旦累积到足够大的 delay（>= MIN_DELAY），
        // 就把当前这一帧作为一个输出帧
        newFrameIndices.push(i)
        newDelays.push(Math.max(MIN_DELAY, Math.round(pendingDelay)))
        pendingDelay = 0
        pendingIndex = i
      } else {
        // 否则继续累积，等后面的帧一起“打包”进前一帧的显示时间里
        // —— 视觉上会少播一些帧，但整体时长是正确的
      }
    }

    // 如果最后还剩一点没 flush 的 delay，就合并到最后一帧上
    if (pendingDelay > 0 && newDelays.length > 0) {
      newDelays[newDelays.length - 1] += Math.round(pendingDelay)
    }

    // 极端情况下可能只剩 1 帧，勉强也能算加速（变成定格动画了）
    if (newFrameIndices.length === 0) {
      newFrameIndices = [0]
      newDelays = [Math.max(MIN_DELAY, Math.round(originalDelay.reduce((a, b) => a + b, 0) / speed))]
    }
  }

  // === 拿 RAW 像素，按新帧序列“重排像素” ===

  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  const frames = pages
  const imgWidth = info.width
  const totalHeight = info.height
  const channels = info.channels

  const frameHeight = totalHeight / frames
  const frameSize = imgWidth * frameHeight * channels

  const newFramesCount = newFrameIndices.length
  const newData = new Uint8Array(frameSize * newFramesCount)

  for (let j = 0; j < newFramesCount; j++) {
    const srcFrameIndex = newFrameIndices[j]
    const srcOffset = srcFrameIndex * frameSize
    const dstOffset = j * frameSize

    const slice = data.subarray(srcOffset, srcOffset + frameSize)
    newData.set(slice, dstOffset)
  }

  // === 重新编码为动图，写回新的 delay & 保留 loop ===

  let out = sharp(newData, {
    raw: {
      width: imgWidth,
      height: frameHeight * newFramesCount,
      channels,
      pageHeight: frameHeight
    },
    animated: newFramesCount > 1
  })

  if (format === 'gif') {
    out = out.gif({
      delay: newDelays,
      loop: typeof loop === 'number' ? loop : 0
    })
  } else if (format === 'webp') {
    out = out.webp({
      delay: newDelays,
      loop: typeof loop === 'number' ? loop : 0
    })
  }

  return await out.toBuffer()
}
