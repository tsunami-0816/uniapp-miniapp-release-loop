// 预约表单的日期窗口与错误映射（从 pages/booking/form.vue 抽出，保证单文件 ≤400 行）
export interface DateWindow {
  minDate: string
  maxDate: string
}

export function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 可约窗口：今天起 30 天（与后端 booking.window-days 对齐） */
export function dateWindow(now: Date = new Date(), days = 30): DateWindow {
  return {
    minDate: formatDate(now),
    maxDate: formatDate(new Date(now.getTime() + days * 86400000))
  }
}

/** 后端 40001 的字段前缀（如 "contact 手机号格式不对"）落到对应字段红字；都不是则返回提示文案 */
export function splitFieldError(msg: string): { field: 'contact' | 'bookDate' | 'slot' | 'packageId' | ''; text: string } {
  const raw = msg || '参数不合法'
  const field = (['contact', 'bookDate', 'slot', 'packageId'] as const).find((f) => raw.includes(f)) || ''
  return { field, text: field ? raw.replace(field + ' ', '') : raw }
}
