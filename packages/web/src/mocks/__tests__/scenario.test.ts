import { beforeEach, describe, expect, it } from 'vitest'
import { getMockScenario } from '../scenario'
import { getMockRole } from '../role'

/** 画面の URL を差し替える（jsdom の location を直接書き換えない） */
function visit(path: string) {
  window.history.replaceState({}, '', path)
}

describe('getMockScenario', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    visit('/')
  })

  it('指定が無ければ既定（口座も登録済みの世帯）を返す', () => {
    expect(getMockScenario()).toBe('default')
  })

  it('クエリで口座未登録を指定するとそのシナリオを返す', () => {
    visit('/settings?section=accounts&mockScenario=accounts-unregistered')
    expect(getMockScenario()).toBe('accounts-unregistered')
  })

  it('未知の値は既定として扱う', () => {
    visit('/?mockScenario=no-such-scenario')
    expect(getMockScenario()).toBe('default')
  })

  it('クエリで指定したシナリオは、クエリの無い画面へ移動しても保たれる', () => {
    visit('/?mockScenario=accounts-unregistered')
    expect(getMockScenario()).toBe('accounts-unregistered')

    // 画面遷移（next/link）はクエリを引き継がない
    visit('/balances')
    expect(getMockScenario()).toBe('accounts-unregistered')
  })

  it('シナリオの指定はロール（テーマ）を変えない', () => {
    visit('/?mockScenario=accounts-unregistered&mockRole=honey')
    expect(getMockRole()).toBe('honey')

    visit('/?mockScenario=default')
    expect(getMockRole()).toBe('honey')
    expect(getMockScenario()).toBe('default')
  })

  it('ロールとシナリオを同時に指定しても、画面遷移後に両方とも保たれる', () => {
    // 保持の仕組みを role と共有したことで生まれる失敗は「保存先の取り違え」。
    // 後から解決したほうが先の値を上書きすると、遷移後に片方が既定へ落ちる
    visit('/settings?section=accounts&mockScenario=accounts-unregistered&mockRole=honey')
    expect(getMockScenario()).toBe('accounts-unregistered')
    expect(getMockRole()).toBe('honey')

    visit('/balances')
    expect(getMockScenario()).toBe('accounts-unregistered')
    expect(getMockRole()).toBe('honey')
  })
})
