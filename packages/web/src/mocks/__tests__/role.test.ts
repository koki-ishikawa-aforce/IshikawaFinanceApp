import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getMockRole } from '../role'

/** 画面の URL を差し替える（jsdom の location を直接書き換えない） */
function visit(path: string) {
  window.history.replaceState({}, '', path)
}

const realSessionStorage = window.sessionStorage

/** sessionStorage が使えない環境（プライベートモード等）を再現する */
function denySessionStorage() {
  const deny = () => {
    throw new Error('sessionStorage is not available')
  }
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: { getItem: deny, setItem: deny },
  })
}

describe('getMockRole', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    visit('/')
  })

  afterEach(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: realSessionStorage,
    })
  })

  it('指定が無ければ darling を返す', () => {
    expect(getMockRole()).toBe('darling')
  })

  it('クエリで honey を指定すると honey を返す', () => {
    visit('/?mockRole=honey')
    expect(getMockRole()).toBe('honey')
  })

  it('未知の値は darling として扱う', () => {
    visit('/?mockRole=someone-else')
    expect(getMockRole()).toBe('darling')
  })

  it('クエリで指定したロールは、クエリの無い画面へ移動しても保たれる', () => {
    visit('/?mockRole=honey')
    expect(getMockRole()).toBe('honey')

    // 画面遷移（next/link）はクエリを引き継がない
    visit('/transactions')
    expect(getMockRole()).toBe('honey')
  })

  it('保持済みのロールはクエリの明示指定で上書きできる', () => {
    visit('/?mockRole=honey')
    getMockRole()

    visit('/?mockRole=darling')
    expect(getMockRole()).toBe('darling')

    visit('/')
    expect(getMockRole()).toBe('darling')
  })

  it('sessionStorage が使えなくても既定にフォールバックして画面は動く', () => {
    denySessionStorage()

    visit('/?mockRole=honey')
    expect(getMockRole()).toBe('honey')

    visit('/')
    expect(getMockRole()).toBe('darling')
  })
})
