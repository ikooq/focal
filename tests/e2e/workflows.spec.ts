import { test, expect, type Page } from '@playwright/test';
let backup: Buffer;
test.beforeAll(async ({ request }) => {
  backup = await (await request.get('/api/backup')).body();
});
test.beforeEach(async ({ request, page }) => {
  const preview = await (
    await request.post('/api/restore/preview', {
      data: backup,
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  ).json();
  const response = await request.post('/api/action', {
    data: { action: 'backup.restore', token: preview.token },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Три главных дела', exact: false }),
  ).toBeVisible();
});
async function addTask(page: Page, title: string) {
  await page.getByRole('button', { name: 'Новая задача', exact: true }).click();
  await page.getByLabel('Что нужно сделать?').fill(title);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('quick task, pause, restart, resume and finish', async ({
  page,
  request,
}) => {
  await addTask(page, 'Проверить предложение');
  await page.getByRole('button', { name: 'Начать фокус', exact: true }).click();
  await page.getByLabel('Режим старта').selectOption('tiny');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Начать фокус', exact: true })
    .click();
  await page.getByRole('button', { name: 'Пауза без штрафа' }).click();
  await expect(page.getByText('На паузе', { exact: true })).toBeVisible();
  const paused = await page.getByRole('timer').innerText();
  await page.reload();
  await expect(page.getByText('На паузе', { exact: true })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText(paused);
  await page
    .getByRole('button', { name: 'Продолжить фокус', exact: true })
    .click();
  await page.getByRole('button', { name: 'Прервать сессию' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Закончить сессию' })
    .click();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('tab', { name: 'Задачи', exact: true }).click();
  await page
    .getByRole('button', { name: 'Завершить: Проверить предложение' })
    .click();
  const state = await (await request.get('/api/state')).json();
  expect(state.tasks[0].status).toBe('completed');
  expect(state.transactions).toHaveLength(0);
});

test('calendar event can be moved through its editor and undone', async ({
  page,
  request,
}) => {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(12, 0, 0, 0);
  await request.post('/api/action', {
    data: {
      action: 'event.save',
      title: 'Встреча для проверки',
      description: '',
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + 3600000).toISOString(),
      color: 'emerald',
      reminder_minutes: 0,
    },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Открыть в календаре' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const end = new Date(start.getTime() + 2 * 3600000);
  const local = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:00`;
  await page.getByLabel('Окончание', { exact: true }).fill(local(end));
  await page.getByRole('button', { name: 'Сохранить время' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    (await (await request.get('/api/state')).json()).events[0].end_at,
  ).toBe(end.toISOString());
  await page
    .getByRole('button', { name: 'Отменить последнее изменение календаря' })
    .click();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/state')).json()).events[0].end_at,
    )
    .toBe(new Date(start.getTime() + 3600000).toISOString());
});

test('backup preview and restore through the interface', async ({
  page,
  request,
}) => {
  await addTask(page, 'До резервной копии');
  const saved = await (await request.get('/api/backup')).body();
  await addTask(page, 'После резервной копии');
  await page.locator('.more-nav > summary').click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page
    .getByRole('button', { name: 'Резервные копии и восстановление' })
    .click();
  await page.getByLabel('Резервная копия SQLite').setInputFiles({
    name: 'backup.sqlite',
    mimeType: 'application/octet-stream',
    buffer: saved,
  });
  await expect(
    page.getByText('Копия проверена', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('Заменить текущие данные этой копией').check();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Восстановить данные', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const state = await (await request.get('/api/state')).json();
  expect(state.tasks.map((t: { title: string }) => t.title)).toEqual([
    'До резервной копии',
  ]);
});

test('finish day and hide optional sections; mobile remains within viewport', async ({
  page,
  request,
}) => {
  await addTask(page, 'Первое дело завтра');
  await page
    .getByRole('button', { name: 'Завершить день', exact: true })
    .click();
  await page.getByLabel('Итог дня', { exact: true }).fill('Собрал материалы');
  const state = await (await request.get('/api/state')).json();
  await page
    .getByLabel('Первое дело на завтра')
    .selectOption(state.tasks[0].id);
  await page.getByLabel('Первый конкретный шаг').fill('Открыть материалы');
  await page.getByRole('button', { name: 'Сохранить итог и план' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.more-nav > summary').click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByLabel('Финансы', { exact: true }).uncheck();
  await expect(
    page
      .locator('.more-menu')
      .getByRole('button', { name: 'Финансы', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page
      .locator('.more-menu')
      .getByRole('button', { name: 'Финансы', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('tab', { name: 'Сегодня', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Видимые разделы' }),
  ).toBeHidden();
  await page.screenshot({
    path: 'output/playwright/desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'output/playwright/mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test('capture, repeat configuration, kanban, saved views and bulk tags', async ({
  page,
  request,
}) => {
  await page.getByRole('button', { name: 'Быстрый ввод', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Быстрый ввод', exact: true })
    .fill('Позвонить клиенту');
  await page
    .getByRole('textbox', { name: 'Быстрый ввод', exact: true })
    .press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Новая задача', exact: true }).click();
  await page.getByLabel('Что нужно сделать?').fill('Оплатить счета');
  await page.locator('.task-options > summary').click();
  await page.getByLabel('Метки · через запятую').fill('Дом, Финансы');
  await page
    .getByRole('combobox', { name: 'Повторять', exact: true })
    .selectOption('monthly');
  await page.getByLabel('Число месяца').fill('10');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Задачи', exact: true }).click();
  await page.getByRole('button', { name: 'Канбан', exact: true }).click();
  const card = page.locator('.work-card').filter({
    has: page.getByRole('button', { name: 'Позвонить клиенту', exact: true }),
  });
  await card.dragTo(page.locator('.kanban-column.waiting'));
  await expect(
    page
      .locator('.kanban-column.waiting')
      .getByRole('button', { name: 'Позвонить клиенту', exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole('button', { name: 'Фокус', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Состояние: Позвонить клиенту').selectOption('doing');
  await expect(
    page
      .locator('.kanban-column.doing')
      .getByRole('button', { name: 'Позвонить клиенту', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Выбрать все', { exact: true }).check();
  await page.getByLabel('Массовое действие').selectOption('tag');
  await page.getByLabel('Метка для выбранных задач').fill('Важное');
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.locator('.bulk-bar')).toHaveCount(0);
  await page.getByLabel('Фильтр по метке').selectOption('Важное');
  await page.getByText('Сохранить фильтр', { exact: true }).click();
  await page.getByLabel('Название представления').fill('Важные дела');
  await page
    .locator('.saved-views')
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Важные дела', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Завершить: Оплатить счета' }).click();
  await expect
    .poll(async () => {
      const s = await (await request.get('/api/state')).json();
      return s.tasks.filter(
        (t: { title: string }) => t.title === 'Оплатить счета',
      ).length;
    })
    .toBe(2);
  await page.reload();
  await page.getByRole('button', { name: 'Важные дела', exact: true }).click();
  await expect(page.getByLabel('Фильтр по метке')).toHaveValue('Важное');
  await page.getByRole('button', { name: 'Канбан', exact: true }).click();
  await page.getByLabel('Фильтр задач').selectOption('all');
  await page.screenshot({
    path: 'output/playwright/kanban-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'output/playwright/kanban-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test('dependencies block UI, trash restore preserves notes, commands capture thoughts', async ({
  page,
  request,
}) => {
  const create = async (title: string) => {
    const s = await (
      await request.post('/api/action', {
        data: {
          action: 'task.save',
          title,
          brain_hemisphere: 'analytical',
          required_energy: 5,
          penalty_amount: '0',
        },
      })
    ).json();
    return s.tasks.find((t: { title: string }) => t.title === title);
  };
  const a = await create('Согласовать цену');
  await create('Отправить предложение');
  await page.reload();
  await page.getByRole('tab', { name: 'Задачи', exact: true }).click();
  await page
    .getByRole('button', { name: 'Отправить предложение', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByText('Зависимости', { exact: true })
    .click();
  await page.getByLabel('Зависит от задачи').selectOption(a.id);
  await page
    .locator('.dependency-editor')
    .getByRole('button', { name: 'Добавить', exact: true })
    .click();
  await expect(page.locator('.dependency-row')).toHaveCount(1);
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Начать фокус', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'В корзину: Согласовать цену' })
    .click();
  await expect(page.locator('.waiting-line')).toContainText('в корзине');
  await page.locator('.more-nav > summary').click();
  await page.getByRole('button', { name: 'Корзина', exact: true }).click();
  await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
  await expect(page.getByText('Корзина пуста', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Задачи', exact: true }).click();
  await page
    .getByRole('button', { name: 'Завершить: Согласовать цену' })
    .click();
  await expect(
    page
      .locator('.work-card')
      .filter({
        has: page.getByRole('button', {
          name: 'Отправить предложение',
          exact: true,
        }),
      })
      .getByRole('button', { name: 'Фокус', exact: true }),
  ).toBeEnabled();
  await page.keyboard.press('Control+k');
  await page.getByRole('option', { name: 'Записать мысль или задачу' }).click();
  await page.getByRole('button', { name: 'Мысль', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Быстрый ввод', exact: true })
    .fill('Идея для проекта');
  await page
    .getByRole('textbox', { name: 'Быстрый ввод', exact: true })
    .press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const s = await (await request.get('/api/state')).json();
  expect(s.thoughts[0].body).toBe('Идея для проекта');
});

test('day capacity offers concrete moves and resume card exposes next step', async ({
  page,
  request,
}) => {
  const state = await (await request.get('/api/state')).json();
  const d = new Date(state.server_now);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ids: string[] = [];
  for (const title of ['Собрать материалы', 'Подготовить макет']) {
    const s = await (
      await request.post('/api/action', {
        data: {
          action: 'task.save',
          title,
          brain_hemisphere: 'analytical',
          required_energy: 5,
          penalty_amount: '0',
          estimated_minutes: 600,
        },
      })
    ).json();
    const id = s.tasks.find((t: { title: string }) => t.title === title).id;
    ids.push(id);
    await request.post('/api/action', {
      data: { action: 'task.plan', id, planned_date: date, is_priority: false },
    });
  }
  await request.post('/api/action', {
    data: {
      action: 'checkpoint.add',
      task_id: ids[0],
      summary: 'Нашёл примеры',
      next_step: 'Открыть заметки и выбрать три примера',
    },
  });
  await page.reload();
  await expect(
    page.getByText('Открыть заметки и выбрать три примера', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Облегчить день/ }).click();
  await expect(page.locator('.capacity-review li')).not.toHaveCount(0);
  await page.screenshot({
    path: 'output/playwright/today-workflow.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page
    .getByRole('button', { name: 'Перенести выбранные', exact: true })
    .click();
  await expect(page.locator('.capacity-review')).toHaveCount(0);
  const after = await (await request.get('/api/state')).json();
  expect(
    after.tasks.some((t: { planned_date: string }) => t.planned_date !== date),
  ).toBeTruthy();
});
