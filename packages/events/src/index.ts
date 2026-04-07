import { EventEmitter } from 'events'

type EventMap = {
  'lesson.completed': { studentId: string; lessonId: string; tenantId: string }
  'activity.correct': { studentId: string; activityId: string; tenantId: string }
  'srs.reviewed': { studentId: string; srsItemId: string; tenantId: string; quality: number }
  'streak.milestone': { studentId: string; tenantId: string; days: number }
  'billing.renewed': { tenantId: string }
}

class TypedEventBus {
  private emitter = new EventEmitter()

  on<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void): void {
    this.emitter.on(event, listener)
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.emitter.emit(event, payload)
  }

  off<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void): void {
    this.emitter.off(event, listener)
  }
}

export const eventBus = new TypedEventBus()
export type { EventMap }
