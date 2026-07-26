// 見守りの時刻（起床のころ／おやすみのころ）の保存と判定。
//
// 保存先はブラウザの localStorage です。外部へは送りません。
// 将来クラウドで管理するようになったら、この2つの関数の中だけを差し替えます。

import type { InterviewSlot } from '../types'

export interface WatchTimes {
  morning: string // "07:00" の形
  evening: string // "21:00" の形
}

const STORAGE_KEY = 'hp.watchTimes'

const DEFAULT_TIMES: WatchTimes = {
  morning: '07:00',
  evening: '21:00',
}

// 設定時刻の前後この分数のあいだに入ったら、問診を始めてよいものとする。
// 「7時ちょうどに起きていなければ問診できない」では厳しすぎるため幅を持たせる。
export const WATCH_WINDOW_MINUTES = 30

export function loadWatchTimes(): WatchTimes {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_TIMES
    const parsed = JSON.parse(raw) as Partial<WatchTimes>
    return {
      morning: parsed.morning ?? DEFAULT_TIMES.morning,
      evening: parsed.evening ?? DEFAULT_TIMES.evening,
    }
  } catch {
    // 壊れた値が入っていても既定値で動かす（設定のせいでアプリが止まらないように）。
    return DEFAULT_TIMES
  }
}

export function saveWatchTimes(times: WatchTimes): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(times))
}

// "07:00" を、その日の0時からの経過分数に直す。
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  const hours = Number(m[1])
  const mins = Number(m[2])
  if (hours > 23 || mins > 59) return null
  return hours * 60 + mins
}

// 今が問診の時間帯かどうかを判定する。該当しなければ null。
export function currentSlot(times: WatchTimes, now: Date = new Date()): InterviewSlot | null {
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  for (const slot of ['morning', 'evening'] as const) {
    const target = toMinutes(times[slot])
    if (target === null) continue
    if (Math.abs(nowMinutes - target) <= WATCH_WINDOW_MINUTES) return slot
  }
  return null
}

// その日にその時間帯の問診をもう済ませたか（1日2回までにするための記録）。
// 日付をまたげば自動的にリセットされる。
function doneKey(slot: InterviewSlot, now: Date): string {
  const date = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
  return `hp.interviewDone.${slot}.${date}`
}

export function isDoneToday(slot: InterviewSlot, now: Date = new Date()): boolean {
  return window.localStorage.getItem(doneKey(slot, now)) !== null
}

export function markDoneToday(slot: InterviewSlot, now: Date = new Date()): void {
  window.localStorage.setItem(doneKey(slot, now), new Date().toISOString())
}
