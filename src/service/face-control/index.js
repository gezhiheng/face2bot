import { sendCommand } from '@/service/serial'
import { faceLandmarks } from '@/service/vision'
import { ref, watchEffect } from 'vue'

const IDX = Object.freeze({
  leftEyeOuter: 359,
  rightEyeOuter: 130,

  leftEyebrow: 336,
  leftEyebrowCorner: 300,
  rightEyebrow: 107,
  rightEyebrowCorner: 70,
  middleEyebrow: 8,

  leftEyeball: 473,

  leftUpperEyelid: 386,
  leftLowerEyelid: 374,
  rightUpperEyelid: 159,
  rightLowerEyelid: 145,

  leftUpperMouth: 391,
  leftLowerMouth: 314,
  rightUpperMouth: 37,
  rightLowerMouth: 84,

  rightUpperCheek: 207,
  rightLowerCheek: 214,
  leftUpperCheek: 427,
  leftLowerCheek: 434,

  noseTip: 4,
  upperLip: 11,
  lowerLip: 16,
  zero: 0,
})

let servoConfigs = [
  // 眉毛
  { idx: 'leftEyebrow', ref: 'middleEyebrow', axis: 'y', pin: 5, closed: 45, open: 125, dMin: 0.219, dMax: 0.279, prefix: 'U' },
  // leftEyebrowConner 随着 leftEyebrow 一起动
  { idx: 'leftEyebrow', ref: 'middleEyebrow', axis: 'y', pin: 7, closed: 130, open: 70, dMin: 0.219, dMax: 0.279, prefix: 'U' },
  { idx: 'rightEyebrow', ref: 'middleEyebrow', axis: 'y', pin: 4, closed: 130, open: 70, dMin: 0.219, dMax: 0.279, prefix: 'U' },
  // rightEyebrowConner 随着 rightEyebrow 一起动
  { idx: 'rightEyebrow', ref: 'middleEyebrow', axis: 'y', pin: 6, closed: 50, open: 125, dMin: 0.219, dMax: 0.279, prefix: 'U' },

  // // 眼部
  { idx: 'leftEyeball', ref: 'leftEyeOuter', axis: 'x', pin: 2, closed: 130, open: 50, dMin: 0.186, dMax: 0.312, prefix: 'U' },
  { idx: 'leftEyeball', ref: 'leftEyeOuter', axis: 'y', pin: 3, closed: 90, open: 140, dMin: 0.132, dMax: 0.174, prefix: 'U' },
  { idx: 'rightLowerEyelid', ref: 'rightUpperEyelid', axis: 'y', pin: 11, closed: 80, open: 43, dMin: 0.1, dMax: 0.262, prefix: 'U' },
  { idx: 'rightUpperEyelid', ref: 'rightLowerEyelid', axis: 'y', pin: 10, closed: 90, open: 180, dMin: 0.1, dMax: 0.244, prefix: 'U' },
  { idx: 'leftLowerEyelid', ref: 'leftUpperEyelid', axis: 'y', pin: 13, closed: 80, open: 134, dMin: 0.1, dMax: 0.262, prefix: 'U' },
  { idx: 'leftUpperEyelid', ref: 'leftLowerEyelid', axis: 'y', pin: 12, closed: 110, open: 20, dMin: 0.1, dMax: 0.244, prefix: 'U' },

  // mouth
  { idx: 'rightUpperMouth', ref: 'zero', axis: 'distance', pin: 6, closed: 40, open: 130, dMin: 0.18, dMax: 0.23, prefix: 'F' },
  { idx: 'rightLowerMouth', ref: 'zero', axis: 'distance', pin: 7, closed: 120, open: 40, dMin: 0.39, dMax: 0.94, prefix: 'F' },
  { idx: 'leftUpperMouth', ref: 'zero', axis: 'distance', pin: 8, closed: 135, open: 50, dMin: 0.18, dMax: 0.23, prefix: 'F' },
  { idx: 'leftLowerMouth', ref: 'zero', axis: 'distance', pin: 9, closed: 92, open: 150, dMin: 0.39, dMax: 0.94, prefix: 'F' },

  // cheek
  { idx: 'upperLip', ref: 'lowerLip', axis: 'distance', pin: 3, closed: 20, open: 120, dMin: 0.58, dMax: 0.64, prefix: 'F' },
  { idx: 'upperLip', ref: 'lowerLip', axis: 'distance', pin: 2, closed: 125, open: 35, dMin: 0.68, dMax: 0.73, prefix: 'F' },
  { idx: 'upperLip', ref: 'lowerLip', axis: 'distance', pin: 5, closed: 70, open: 160, dMin: 0.54, dMax: 0.61, prefix: 'F' },
  { idx: 'upperLip', ref: 'lowerLip', axis: 'distance', pin: 4, closed: 140, open: 62, dMin: 0.65, dMax: 0.75, prefix: 'F' },

  // 嘴唇
  { idx: 'upperLip', ref: 'lowerLip', axis: 'distance', pin: 0, closed: 100, open: 70, dMin: 0.25, dMax: 1.05, prefix: 'F' },
]

export function setConfig(config) {
  servoConfigs = config
}

export function getConfig() {
  return servoConfigs
}

export const delayMS = ref(1)

const lastAngles = Object.fromEntries(servoConfigs.map(c => [c.pin, null]))
let lastSentTime = 0

const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v))

const delay = ms => new Promise(r => setTimeout(r, ms))

function map(v, iMin, iMax, oMin, oMax) {
  const t = clamp((v - iMin) / (iMax - iMin))
  return oMin + t * (oMax - oMin)
}

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// 逆时针绕 center 旋转 point
function rotatePoint(point, center, angle) {
  const x0 = point.x - center.x
  const y0 = point.y - center.y
  const cosA = Math.cos(-angle)
  const sinA = Math.sin(-angle)
  return {
    x: x0 * cosA - y0 * sinA + center.x,
    y: x0 * sinA + y0 * cosA + center.y,
  }
}

watchEffect(() => {
  const lm = faceLandmarks.value
  if (!lm || lm.length < 478) {
    return
  }

  const now = Date.now()
  if (now - lastSentTime < 15) {
    return
  }
  lastSentTime = now

  // 计算 Roll 角
  const leftEye = lm[IDX.leftEyeOuter]
  const rightEye = lm[IDX.rightEyeOuter]
  const roll = Math.atan2(
    rightEye.y - leftEye.y,
    rightEye.x - leftEye.x,
  )
  // 计算基准距离，用于标准化
  const dRef = distance2D(leftEye, rightEye)
  // 旋转中心：鼻尖
  const center = lm[IDX.noseTip]

  ;(async () => {
    for (const cfg of servoConfigs) {
      let p1 = lm[IDX[cfg.idx]]
      let p2 = lm[IDX[cfg.ref]]
      if (!p1 || !p2) {
        continue
      }

      p1 = rotatePoint(p1, center, roll)
      p2 = rotatePoint(p2, center, roll)

      const rawDelta = cfg.axis === 'distance' ? distance2D(p1, p2) : Math.abs(p1[cfg.axis] - p2[cfg.axis])
      const normDelta = rawDelta / dRef
      const m = 0.001
      const b = 0.102
      const normCorrected = normDelta - m * roll + b
      // if (cfg.idx === 'rightUpperMouth') {
      //   console.log(normCorrected)
      // }

      const angle = Math.round(map(normCorrected, cfg.dMin, cfg.dMax, cfg.closed, cfg.open))
      if (angle !== lastAngles[cfg.pin]) {
        sendCommand(`${cfg.prefix}:${cfg.pin},${angle}`)
        lastAngles[cfg.pin] = angle
        await delay(delayMS.value)
      }
    }
  })()
})
