// アバターの見た目（水色に発光するネオン線画の猫の顔）。
// ロジックは持たず、状態(state)を受け取って表情を切り替えるだけ。
// 発光は CSS の drop-shadow（Avatar.css）で表現している。
// デザイン差し替え時は、このSVGを差し替えれば済むよう見た目だけをここに閉じ込めている。

import type { AvatarState } from '../../types'
import './Avatar.css'

export default function Avatar({ state }: { state: AvatarState }) {
  return (
    <div className={`avatar avatar-${state}`}>
      <svg
        className="cat-svg"
        viewBox="0 0 320 300"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="アバターの猫の顔"
      >
        {/* 発光する線画はすべてこのグループにまとめ、まとめて拡大・振動アニメする */}
        <g className="cat-group">
          {/* 猫耳（左右） */}
          <path className="cat-stroke" d="M95 108 L70 32 L146 80" />
          <path className="cat-stroke" d="M225 108 L250 32 L174 80" />

          {/* 顔の輪郭（角の丸い四角） */}
          <rect
            className="cat-stroke"
            x="58"
            y="78"
            width="204"
            height="176"
            rx="80"
            ry="74"
          />

          {/* ほおのヒゲ（左右・常時表示） */}
          <path className="cat-stroke cat-whisker" d="M74 176 L104 180" />
          <path className="cat-stroke cat-whisker" d="M74 190 L104 191" />
          <path className="cat-stroke cat-whisker" d="M246 176 L216 180" />
          <path className="cat-stroke cat-whisker" d="M246 190 L216 191" />

          {/* 小さな鼻 */}
          <path className="cat-stroke" d="M154 190 L166 190 L160 197 Z" />

          {/* ==== 表情（状態で切り替え） ==== */}

          {state === 'idle' && (
            <>
              {/* 待機: にっこり閉じ目（^ ^）＋小さな口 */}
              <path className="cat-stroke" d="M110 168 Q128 152 146 168" />
              <path className="cat-stroke" d="M174 168 Q192 152 210 168" />
              <path className="cat-stroke" d="M146 206 Q153 214 160 206 Q167 214 174 206" />
            </>
          )}

          {state === 'listening' && (
            <>
              {/* 傾聴: まん丸の大きな目（しっかり聞いている）＋小さめの口 */}
              <circle className="cat-stroke" cx="128" cy="166" r="22" />
              <circle className="cat-stroke" cx="192" cy="166" r="22" />
              <ellipse className="cat-stroke" cx="160" cy="208" rx="7" ry="6" />
            </>
          )}

          {state === 'speaking' && (
            <>
              {/* 発話: 片目まん丸＋片目ウインク（＜）＋きらり＋開いた口（アニメ） */}
              <circle className="cat-stroke" cx="126" cy="166" r="17" />
              <path className="cat-stroke" d="M180 156 L206 166 L180 176" />
              {/* きらり（星） */}
              <path
                className="cat-stroke cat-sparkle"
                d="M222 128 L226 138 L236 142 L226 146 L222 156 L218 146 L208 142 L218 138 Z"
              />
              {/* 話している口（CSSで開閉アニメ） */}
              <ellipse
                className="cat-stroke cat-mouth-speaking"
                cx="160"
                cy="210"
                rx="16"
                ry="12"
              />
            </>
          )}
        </g>
      </svg>
    </div>
  )
}
