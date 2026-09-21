# Furry Art Manager

Создай локальное десктопное приложение для Windows под названием Furry Content Manager.



Цель приложения:

Помогать автору AI-изображений управлять контентом перед публикацией на DeviantArt.



Важно:

Приложение должно работать локально на компьютере пользователя. Изображения не должны отправляться на внешние серверы. Все файлы должны храниться локально.



Основной сценарий работы:



1. Пользователь генерирует изображения в Stable Diffusion.



2. Пользователь импортирует папку с изображениями в приложение.



3. Приложение показывает изображения в виде сетки превью.



4. Пользователь вручную отмечает хорошие изображения.



5. После нажатия кнопки Process приложение автоматически:



* создает папку проекта;

* копирует выбранные изображения;

* создает preview-версии уменьшенного размера;

* накладывает водяной знак;

* сохраняет full-resolution версии;

* создает ZIP-архив с оригиналами.



6. Для каждого изображения приложение должно уметь:



* генерировать название;

* генерировать список тегов;

* генерировать описание публикации.



7. Пользователь может редактировать название, теги и описание вручную.



8. Все данные проекта сохраняются локально.



Дополнительные функции:



* База персонажей.

  Для каждого персонажа хранить:



  * имя;

  * вид;

  * описание;

  * базовые теги;

  * заметки.



* База проектов.

  Для каждого проекта хранить:



  * дату;

  * персонажа;

  * количество изображений;

  * статус.



Интерфейс должен быть максимально простым и рассчитанным на пользователя без технических знаний.



Первая версия должна работать полностью локально и без необходимости регистрации.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://furry-forge-helper.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/dca2c55d-0505-4d17-803c-97386be00175).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
