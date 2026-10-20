import { expect, test } from '@playwright/test'

test.describe.configure({ retries: 1 })
test.skip(!process.env.P2P_LIVE, 'Opt-in : dépend du serveur de signalisation PeerJS configuré.')

test('three real browser contexts survive the host leaving', async ({ browser }) => {
  test.setTimeout(60_000)
  const hostContext = await browser.newContext()
  const guestOneContext = await browser.newContext()
  const guestTwoContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guestOne = await guestOneContext.newPage()
  const guestTwo = await guestTwoContext.newPage()

  await host.goto('/')
  await host.getByLabel('Votre pseudonyme').fill('Orion')
  await host.getByRole('button', { name: /Créer une partie/ }).click()
  await expect(host.getByText('SALON PRIVÉ')).toBeVisible({ timeout: 15_000 })
  const code = (await host.locator('.room-code-card strong').textContent())?.trim()
  expect(code).toMatch(/^[A-Z2-9]{6}$/)

  await Promise.all([guestOne.goto(`/?room=${code}`), guestTwo.goto(`/?room=${code}`)])
  await guestOne.getByLabel('Votre pseudonyme').fill('Lyra')
  await guestTwo.getByLabel('Votre pseudonyme').fill('Vega')
  await guestOne.getByRole('button', { name: /Rejoindre la table/ }).click()
  await expect(guestOne.getByText('SALON PRIVÉ')).toBeVisible({ timeout: 15_000 })
  await expect(host.getByText('Lyra', { exact: false })).toBeVisible({ timeout: 15_000 })
  await guestTwo.getByRole('button', { name: /Rejoindre la table/ }).click()
  await expect(guestTwo.getByText('SALON PRIVÉ')).toBeVisible({ timeout: 15_000 })
  await expect(host.getByText('Vega', { exact: false })).toBeVisible({ timeout: 15_000 })

  await guestOne.getByRole('button', { name: /Je suis prêt/ }).click()
  await guestTwo.getByRole('button', { name: /Je suis prêt/ }).click()
  const start = host.getByRole('button', { name: /Lancer la partie/ })
  await expect(start).toBeEnabled({ timeout: 15_000 })
  await start.click()
  await Promise.all([
    expect(host.locator('.game-view')).toBeVisible(),
    expect(guestOne.locator('.game-view')).toBeVisible(),
    expect(guestTwo.locator('.game-view')).toBeVisible(),
  ])

  await hostContext.close()
  await Promise.all([
    expect(guestOne.getByText(/Nouvel hôte :/)).toBeVisible({ timeout: 20_000 }),
    expect(guestTwo.getByText(/Nouvel hôte :/)).toBeVisible({ timeout: 20_000 }),
  ])

  await Promise.all([guestOneContext.close(), guestTwoContext.close()])
})
