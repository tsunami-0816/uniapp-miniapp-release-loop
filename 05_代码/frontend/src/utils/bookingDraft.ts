// 预约表单草稿：未登录提交 → 跳登录 → 回跳本页时把填写内容带回来（第 9 步走查 Q-043）
// 存本地（uni storage），不放 URL；只认同一套餐，取出即删，避免旧草稿串场地
export interface BookingDraft {
  packageId: number
  bookDate: string
  slot: string
  contact: string
  remark: string
  at: number
}

const DRAFT_KEY = 'ub_booking_draft'

export function saveBookingDraft(draft: BookingDraft): void {
  try {
    const empty = !draft.bookDate && !draft.slot && !draft.contact && !draft.remark
    if (empty) {
      uni.removeStorageSync(DRAFT_KEY)
      return
    }
    uni.setStorageSync(DRAFT_KEY, draft)
  } catch {
    // 存不进本地不影响主流程，用户重填即可
  }
}

export function clearBookingDraft(): void {
  try {
    uni.removeStorageSync(DRAFT_KEY)
  } catch {
    // 忽略
  }
}

/** 取出并删除草稿；套餐不一致直接丢弃（例如用户在另一档填过） */
export function takeBookingDraft(packageId: number): BookingDraft | null {
  let draft: BookingDraft | null = null
  try {
    const raw = uni.getStorageSync(DRAFT_KEY)
    draft = raw ? (raw as BookingDraft) : null
  } catch {
    draft = null
  }
  if (!draft) return null
  clearBookingDraft()
  return draft.packageId === packageId ? draft : null
}
