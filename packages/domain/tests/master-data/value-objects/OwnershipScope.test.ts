import { describe, it, expect } from 'vitest'
import {
  assertVisibleTo,
  type OwnershipScope,
} from '../../../src/master-data/value-objects/OwnershipScope'
import { PermissionDeniedError } from '../../../src/shared/errors/DomainError'
import type { UserId } from '../../../src/shared/ids'

const userA = 'user_darling' as UserId
const userB = 'user_honey' as UserId

describe('assertVisibleTo（所有スコープの閲覧可否、09-aggregates #18/#19）', () => {
  it('世帯共有スコープは誰でも閲覧可能', () => {
    const scope: OwnershipScope = { kind: 'household_shared' }
    expect(() => assertVisibleTo(scope, userA, 'カテゴリ')).not.toThrow()
    expect(() => assertVisibleTo(scope, userB, 'カテゴリ')).not.toThrow()
  })

  it('本人の個人別スコープは閲覧可能', () => {
    const scope: OwnershipScope = { kind: 'personal', userId: userA }
    expect(() => assertVisibleTo(scope, userA, 'カテゴリ')).not.toThrow()
  })

  it('他ユーザーの個人別スコープは PermissionDeniedError', () => {
    const scope: OwnershipScope = { kind: 'personal', userId: userA }
    expect(() => assertVisibleTo(scope, userB, 'カテゴリ')).toThrow(PermissionDeniedError)
  })

  it('エラーメッセージにラベルが含まれる', () => {
    const scope: OwnershipScope = { kind: 'personal', userId: userA }
    expect(() => assertVisibleTo(scope, userB, '経費種別')).toThrow(
      '他ユーザーの経費種別は移動先にできない',
    )
  })
})
