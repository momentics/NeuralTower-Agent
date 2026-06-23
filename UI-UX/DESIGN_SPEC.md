# NeuralTower Agent — Спецификация интерфейса

## 1. Общие принципы

- **Тема:** Catppuccin Mocha — тёмная палитра с мягкими цветами
- **Стиль:** Минимализм, чёткая иерархия, компактность (sidebar VS Code — 380-480px ширина)
- **Шрифты:** Inter (UI), JetBrains Mono (код)
- **Радиусы:** 8px (элементы), 12px (карточки), 16px (секции)
- **Анимации:** 150ms для hover, 200ms для переходов

## 2. Палитра (Catppuccin Mocha)

| Роль | Цвет | HEX |
|------|------|-----|
| Основной фон | Base | `#1e1e2e` |
| Вторичный фон | Mantle | `#181825` |
| Третичный фон | Crust | `#11111b` |
| Поверхность | Surface0 | `#313244` |
| Hover | Overlay0 | `#45475a` |
| Акцент | Blue | `#89b4fa` |
| Акцент hover | Sky | `#74c7ec` |
| Успех | Green | `#a6e3a1` |
| Ошибка | Red | `#f38ba8` |
| Предупреждение | Yellow | `#f9e2af` |
| Инструменты | Peach | `#fab387` |
| Информация | Teal | `#94e2d5` |
| Специальное | Pink | `#f5c2e7` |
| Фиолетовый | Mauve | `#cba6f7` |
| Текст основной | Text | `#cdd6f4` |
| Текст вторичный | Subtext0 | `#a6adc8` |
| Текст приглушённый | Overlay2 | `#6c7086` |
| Граница | Overlay0 | `#45475a` |

## 3. Структура sidebar

```
┌─────────────────────────────┐
│  Header: Logo + Title +     │  ← 32px высота
│         + (новый) ⚙ (настр) │
├─────────────────────────────┤
│  Mode bar: [Построение]     │  ← 32px высота
│         [Планирование]      │
│         [Исследование]      │
├─────────────────────────────┤
│  Sessions: ● Задача 1  2h   │  ← 60-100px (3-5 сессий)
│         ● Задача 2  5h      │
│         ● Задача 3  1d      │
├─────────────────────────────┤
│                             │
│         Messages            │  ← гибкая высота (flex:1)
│                             │
├─────────────────────────────┤
│  Context pills (если есть)  │  ← 24px (опционально)
│  ┌───────────────────────┐  │
│  │  Input textarea       │  │  ← 80-140px высота
│  │  [📎] [IDE] [📦]   [↑] │  │
│  └───────────────────────┘  │
├─────────────────────────────┤
│  Status: ● Подключено  ...  │  ← 20px высота
└─────────────────────────────┘
```

## 4. Компоненты

### 4.1 Header

- Логотип: градиентный квадрат 20×20px с иконкой слоёв (3 линии)
- Название: "NeuralTower" — 13px, weight 600
- Кнопки: 28×28px, иконки 16px, hover — фон Surface0

### 4.2 Mode bar

- 3 чипа с иконками и текстом
- Активный: цветной фон (12% opacity) + цветная рамка (25% opacity)
- Неактивный: прозрачный фон + рамка Overlay0
- Иконки:
  - Построение: 🔧 wrench
  - Планирование: 📖 book
  - Исследование: 🔍 search

### 4.3 Sessions

- Заголовок: "Сессии" — 11px, uppercase, letter-spacing 0.8px
- Элемент: dot + title + time
- Dot: 6px круг, зелёный (live) / серый (done)
- Время: now, 2m, 5h, 1d, 2w
- Hover: фон Surface0

### 4.4 Messages

**User message:**
- Avatar: 24×24, bg Surface0, буква "U", 11px bold
- Bubble: bg Blue 12% opacity, border-top-right-radius 2px

**Assistant message:**
- Avatar: 24×24, градиент Blue→Mauve, буква "N", 11px bold
- Bubble: bg Surface0, border-top-left-radius 2px

**Tool use:**
- Margin-left: 32px (под avatar)
- Рамка слева: 2px Peach
- Иконка: 12px + текст 11px

**Tool result:**
- Margin-left: 32px
- Фон: Crust, mono шрифт 10px
- Максимальная высота: 60px с градиентным fade-out

**Streaming indicator:**
- Точка 6px Blue с пульсацией (1s)

### 4.5 Input area

**Context pills:**
- Фон: Surface0, рамка Overlay0
- Иконка файла 10px + имя + × (удалить)
- Радиус: 10px

**Input box:**
- Фон: Base, рамка Overlay0
- Focus: рамка Blue + box-shadow 0 0 0 1px Blue 15% opacity
- Textarea: 13px, min-height 22px, max-height 100px, auto-resize
- Placeholder: "Опишите задачу..."

**Toolbar buttons:**
- 📎 Прикрепить (paperclip)
- 📋 Контекст IDE (layout)
- 📦 Модель (package)
- [spacer]
- ↑ Отправить / ■ Остановить

**Send button:**
- 30×30px, радиус 8px
- Отправить: Blue фон
- Остановить: Red фон

### 4.6 Permission dialog

- Overlay: rgba(0,0,0,0.5)
- Диалог: 280px, bg Surface0, радиус 12px, тень
- Заголовок: иконка предупреждения Yellow + "Запрос разрешения"
- Описание: 11px, с подсветкой имени файла (mono)
- Кнопки: "Отклонить" (серая) / "Разрешить" (Blue)

### 4.7 Status bar

- Высота: 20px, bg Crust
- Слева: ● статус (зелёный/жёлтый/красный) + текст + модель
- Справа: иконка режима + название режима

## 5. Панель настроек

Открывается в отдельной панели VS Code (ViewColumn.Two).

### Секции:

1. **Бэкенд**
   - Адрес сервера: input (mono, 200px)
   - Модель: select (200px)
   - Макс. повторов: input (60px)
   - Таймаут (мс): input (100px)

2. **Агент**
   - Макс. итераций: input (60px)
   - Макс. сессий: input (60px)

3. **Разрешения**
   - Автоодобрение: toggle

4. **Уведомления**
   - Включить уведомления: toggle
   - Завершение агента: toggle
   - Запросы разрешений: toggle

### Действия:
- "Проверить соединение" (secondary)
- "Сохранить" (primary, Blue)
- Статус: "Подключено к серверу" (зелёный) / "Ошибка" (красный)

## 6. Diff viewer

Открывается в ViewColumn.Two.

### Header:
- Иконка + "Изменения агента"
- Статистика: +42 / -18 / 3 файла
- Кнопки: ✓ Принять все / ✗ Отклонить все

### Body:
- Левая панель: список файлов (180px) с иконками
- Правая панель: diff с подсветкой строк
  - Added: bg Green 8% opacity, зелёный текст, +
  - Removed: bg Red 8% opacity, красный текст, -
  - Normal: обычный текст

## 7. VS Code Status Bar

Встроено в строку состояния VS Code:

- Иконка NeuralTower (мозг)
- Режим: "Построение" / "Планирование" / "Исследование"
- Индикатор индексации (спиннер при работе)

## 8. Empty state

Когда чат пуст:

- Логотип: 56×56, градиентный фон, иконка мозга 28px
- Заголовок: "NeuralTower Agent" — 14px bold
- Подзаголовок: "ИИ-ассистент для разработки. Задайте задачу — и агент выполнит её."
- Быстрые действия (2×2 сетка, 260px ширина):
  - 🔧 Исправить баг
  - 📖 Объяснить код
  - 💻 Написать тесты
  - 🔍 Искать в коде

## 9. Анимации и состояния

| Элемент | Анимация | Длительность |
|---------|----------|-------------|
| Hover кнопок | background + color | 150ms ease |
| Focus input | border-color + shadow | 150ms ease |
| Streaming dot | opacity pulse | 1000ms infinite |
| Toggle | transform translateX | 200ms ease |
| Permission overlay | opacity fade | 200ms ease |

## 10. Иконки (Lucide)

Все иконки из набора Lucide (24×24 viewBox, stroke-width 2):

| Действие | Иконка |
|----------|--------|
| Новый чат | `plus` |
| Настройки | `settings` |
| Прикрепить | `paperclip` |
| Контекст IDE | `layout` |
| Модель | `package` |
| Отправить | `arrow-up` |
| Остановить | `square` (filled) |
| Построение | `wrench` |
| Планирование | `book-open` |
| Исследование | `search` |
| Файл | `file-text` |
| Удалить | `trash-2` |
| Принять | `check` |
| Отклонить | `x` |
| Предупреждение | `alert-triangle` |
| Мозг (логотип) | Кастомный SVG |
| Слои (логотип) | `layers` |
| Индексация | `loader` |
| Сессии | `list-collapse` |

## 11. Горячие клавиши

| Действие | Комбинация |
|----------|-----------|
| Фокус на чат | Ctrl+Shift+A |
| Новый чат | Ctrl+Shift+U |
| Объяснить код | Ctrl+Shift+E |
| Исправить код | Ctrl+Shift+F |
| Добавить в контекст | Ctrl+K A |

## 12. Требования к реализации

### Изменения в ChatProvider.ts:
1. Заменить HTML-разметку на новую структуру (header, mode bar, sessions, messages, input)
2. Добавить mode bar с 3 режимами
3. Обновить иконки (SVG вместо символов)
4. Добавить context pills
5. Добавить streaming indicator

### Изменения в chat.css:
1. Полная замена стилей на Catppuccin-палитру
2. Добавить анимации (pulse, hover, focus)
3. Обновить стили сообщений (avatars, bubbles)
4. Добавить стили mode bar, context pills, tool messages
5. Обновить input area (focus states, toolbar)

### Изменения в chat.js:
1. Обновить обработчики для новых элементов
2. Добавить переключение режимов
3. Обновить рендеринг сессий
4. Добавить streaming indicator

### Изменения в SettingsProvider.ts:
1. Обновить HTML на новую структуру
2. Добавить toggle элементы
3. Добавить секции (Агент, Уведомления)

### Изменения в settings.css:
1. Обновить палитру
2. Добавить стили toggle
3. Обновить layout (setting-row с flex)

### Изменения в DiffViewerProvider.ts:
1. Добавить список файлов слева
2. Обновить стили diff (цветовая подсветка)
3. Добавить кнопки принять/отклонить

### Новые элементы:
1. Permission dialog — модальное окно поверх чата
2. VS Code Status Bar — статус подключения и режима
3. Quick actions — быстрые действия в empty state
