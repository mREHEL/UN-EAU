import { expect, test } from '@playwright/test'

test('creates a complete accessible entry screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Les cartes changent/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Créer' })).toBeVisible()
  await page.getByRole('tab', { name: 'Rejoindre' }).click()
  await expect(page.getByLabel('Code du salon')).toBeVisible()
})

test('persists a nickname locally between browser pages', async ({ context }) => {
  const first = await context.newPage()
  await first.goto('/')
  await first.getByLabel('Votre pseudonyme').fill('Nova')
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.getByLabel('Votre pseudonyme')).toHaveValue('Nova')
})

test('opens rule preferences on a mobile viewport', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Paramètres' }).click()
  await expect(page.getByRole('heading', { name: 'Votre table, vos règles.' })).toBeVisible()
  await expect(page.getByText('Règle officielle du +4')).toBeVisible()
})

test('keeps two browser participants isolated', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()
  await Promise.all([host.goto('/'), guest.goto('/?room=ABC234')])
  await host.getByLabel('Votre pseudonyme').fill('Hôte')
  await guest.getByLabel('Votre pseudonyme').fill('Invité')
  await expect(host.getByLabel('Votre pseudonyme')).toHaveValue('Hôte')
  await expect(guest.getByLabel('Votre pseudonyme')).toHaveValue('Invité')
  await expect(guest.getByLabel('Code du salon')).toHaveValue('ABC234')
  await Promise.all([hostContext.close(), guestContext.close()])
})
