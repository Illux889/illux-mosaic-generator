/**
 * Illux Mosaik — page markup.
 *
 * Accessibility notes:
 * - One step is shown at a time; each step is a <section> with its own heading,
 *   and the step list is a <nav> with aria-current="step".
 * - Every control is a native element (button, input, fieldset/legend, dialog).
 * - Only static, translated strings go into this HTML (escaped); anything that
 *   comes from the customer (file names) is set later with textContent.
 * - Heading levels start at `headingLevel` (1 in the standalone page) so the
 *   markup can drop into a Shopware page with a different outline.
 *
 * Two layouts are built from the same pieces (`config.layout`):
 * - 'steps' (default, version 1 and 2): one step at a time with a step list.
 * - 'workspace' (version 3 "Værkstedet"): everything on one screen in three
 *   columns — your images | the mosaic | size and settings — in that reading
 *   order. No step list; the mosaic updates by itself (see app.js).
 */
import { t, raw } from '../i18n/index.js';
import { ICONS, escapeHtml as e } from './dom.js';

const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

/** Radio "choice rows" in illux.dk's configurator style. */
function choiceGroup(name, keys, selected, { legend, help, helpPerChoice } = {}) {
  const choices = raw('options.' + name + '.choices');
  const helpId = 'ilx-mosaic-' + name + '-help';
  return `
    <fieldset class="ilx-mosaic-choices" data-ref="${name}Group" data-setting="${name}">
      <legend class="ilx-mosaic-choices__legend">${e(legend)}</legend>
      ${help ? `<p class="ilx-mosaic-help" id="${helpId}">${e(help)}</p>` : ''}
      <div class="ilx-mosaic-choices__list">
        ${keys.map(key => `
        <label class="ilx-mosaic-choice">
          <input type="radio" name="ilx-mosaic-${name}" value="${key}" ${key === selected ? 'checked' : ''} ${help ? `aria-describedby="${helpId}"` : ''}>
          <span class="ilx-mosaic-choice__text">${e(choices[key])}${helpPerChoice && helpPerChoice[key] ? `<span class="ilx-mosaic-choice__help">${e(helpPerChoice[key])}</span>` : ''}</span>
        </label>`).join('')}
      </div>
    </fieldset>`;
}

function slider(name, min, max, step, value) {
  return `
    <div class="ilx-mosaic-slider">
      <div class="ilx-mosaic-slider__head">
        <label class="ilx-mosaic-fieldlabel" for="ilx-mosaic-${name}-slider">${e(t('options.sliders.' + name))}</label>
        <output class="ilx-mosaic-slider__value" data-ref="${name}Value" for="ilx-mosaic-${name}-slider">${value}</output>
      </div>
      <input class="ilx-mosaic-range" type="range" id="ilx-mosaic-${name}-slider" data-ref="${name}Slider"
        min="${min}" max="${max}" step="${step}" value="${value}">
    </div>`;
}

function stepNav(prev, next, nextLabel, extra = '') {
  return `
    <div class="ilx-mosaic-stepnav">
      ${next ? `<button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--filled" data-next="${next}">${e(nextLabel)}${ICONS.arrowRight}</button>` : ''}
      ${prev ? `<button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--secondary" data-prev="${prev}">${ICONS.arrowLeft}${e(t('steps.back'))}</button>` : ''}
      ${extra}
    </div>`;
}

export function renderTemplate(config) {
  const level = Math.min(4, Math.max(1, config.headingLevel || 1));
  const h1 = 'h' + level, h2 = 'h' + (level + 1), h3 = 'h' + (level + 2);
  const names = raw('steps.names');
  const total = names.length;
  const ws = config.layout === 'workspace';
  const hidden = ws ? '' : ' hidden'; // panels 2–4 start hidden in the step layout only
  const panelTitle = (n, title) => ws ? `
      <${h2} class="ilx-mosaic-panel__title" id="ilx-mosaic-step-${n}-title" tabindex="-1">
        <span class="ilx-mosaic-panel__name">${e(title)}</span>
      </${h2}>` : `
      <${h2} class="ilx-mosaic-panel__title" id="ilx-mosaic-step-${n}-title" tabindex="-1">
        <span class="ilx-mosaic-panel__count">${e(t('steps.progress', { current: n, total }))}<span class="ilx-mosaic-visually-hidden">:</span></span>
        <span class="ilx-mosaic-panel__name">${e(title)}</span>
      </${h2}>`;
  const errorBox = n => ws ? '' : `
      <div class="ilx-mosaic-errorsummary" data-ref="errors${n}" role="alert" tabindex="-1" hidden>
        <${h3} class="ilx-mosaic-errorsummary__title">${ICONS.alert}${e(t('errorSummary.title'))}</${h3}>
        <ul class="ilx-mosaic-errorsummary__list"></ul>
      </div>`;
  const nav = (...args) => ws ? '' : stepNav(...args);
  const opts = config.presets;
  const keyFor = (name, value) => Object.keys(opts[name]).find(k => opts[name][k] === value) || null;

  const header = `<header class="ilx-mosaic-header">
    <${h1} class="ilx-mosaic-title">${e(t(ws ? 'workspace.title' : 'app.title'))}</${h1}>
    <p class="ilx-mosaic-lead">${e(t(ws ? 'workspace.intro' : 'app.intro'))}</p>
    <p class="ilx-mosaic-privacy">${ICONS.lock}<span>${e(t('app.privacy'))}</span></p>
    <p class="ilx-mosaic-note ilx-mosaic-note--danger" data-ref="unsupported" role="alert" hidden>${e(t('app.unsupported'))}</p>
  </header>`;

  const stepList = ws ? '' : `<nav class="ilx-mosaic-steps" aria-label="${e(t('steps.nav'))}">
    <ol class="ilx-mosaic-steps__list">
      ${names.map((name, i) => `
      <li class="ilx-mosaic-steps__item">
        <button type="button" class="ilx-mosaic-steps__button" data-goto="${i + 1}">
          <span class="ilx-mosaic-steps__num" aria-hidden="true"><span class="ilx-mosaic-steps__digit">${i + 1}</span>${ICONS.check}</span>
          <span class="ilx-mosaic-steps__name">${e(name)}<span class="ilx-mosaic-visually-hidden" data-step-state="${i + 1}"></span></span>
        </button>
      </li>`).join('')}
    </ol>
  </nav>`;

  const live = `<div class="ilx-mosaic-visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-ref="live"></div>`;

  const step1 = `<!-- Step 1: main image -->
  <section class="ilx-mosaic-panel" data-panel="1" aria-labelledby="ilx-mosaic-step-1-title">
    ${panelTitle(1, t('target.title'))}
    ${errorBox(1)}
    <p class="ilx-mosaic-help ilx-mosaic-panel__intro">${e(t('target.help'))}</p>
    <div class="ilx-mosaic-upload" data-ref="targetDrop">
      <div class="ilx-mosaic-upload__empty" data-ref="targetEmpty">
        <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--upload" data-ref="targetChoose" id="ilx-mosaic-target-choose">${ICONS.upload}${e(t('target.choose'))}</button>
        <p class="ilx-mosaic-upload__drop">${e(t('target.drop'))}</p>
        <p class="ilx-mosaic-upload__formats">${e(t('target.formats'))}</p>
      </div>
      <figure class="ilx-mosaic-target" data-ref="targetPreview" hidden>
        <img data-ref="targetImg" alt="">
        <figcaption class="ilx-mosaic-target__caption" data-ref="targetInfo"></figcaption>
      </figure>
    </div>
    <p class="ilx-mosaic-busy" data-ref="targetLoading" hidden>${ICONS.spinner}${e(t('target.loading'))}</p>
    <div class="ilx-mosaic-actions" data-ref="targetActions" hidden>
      <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--secondary ilx-mosaic-btn--small" data-ref="targetReplace">${e(t('target.replace'))}</button>
      <button type="button" class="ilx-mosaic-link" data-ref="targetRemove">${e(t('target.remove'))}</button>
    </div>
    <p class="ilx-mosaic-note ilx-mosaic-note--danger" data-ref="targetMsg" role="alert" hidden></p>
    <input type="file" accept="${ACCEPT}" data-ref="targetInput" hidden>
    ${nav(0, 2, t('steps.nextTo', { name: names[1] }))}
  </section>`;

  const step2 = `<!-- Step 2: mosaic photos -->
  <section class="ilx-mosaic-panel" data-panel="2" aria-labelledby="ilx-mosaic-step-2-title"${hidden}>
    ${panelTitle(2, t('sources.title'))}
    ${errorBox(2)}
    <p class="ilx-mosaic-help ilx-mosaic-panel__intro">${e(t('sources.help'))} ${e(t('sources.advice', { min: config.sources.recommendedMin, good: config.sources.good }))}</p>
    <div class="ilx-mosaic-upload" data-ref="sourcesDrop">
      <div class="ilx-mosaic-upload__empty">
        <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--upload" data-ref="sourcesChoose" id="ilx-mosaic-sources-choose">${ICONS.upload}<span data-ref="sourcesChooseText">${e(t('sources.choose'))}</span></button>
        <p class="ilx-mosaic-upload__drop">${e(t('sources.drop'))}</p>
        <p class="ilx-mosaic-upload__formats">${e(t('sources.formats'))}</p>
      </div>
    </div>
    <div class="ilx-mosaic-progress" data-ref="importProgress" hidden>
      <p class="ilx-mosaic-progress__text" id="ilx-mosaic-import-text" data-ref="importText"></p>
      <div class="ilx-mosaic-progress__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-labelledby="ilx-mosaic-import-text" data-ref="importBar">
        <div class="ilx-mosaic-progress__fill" data-ref="importFill"></div>
      </div>
      <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--secondary ilx-mosaic-btn--small" data-ref="importStop">${e(t('sources.importStop'))}</button>
    </div>
    <div class="ilx-mosaic-count" data-ref="sourceSummary">
      <p class="ilx-mosaic-count__number" data-ref="sourceCount">${e(t('sources.countNone'))}</p>
      <p class="ilx-mosaic-count__level" data-ref="sourceLevel" hidden></p>
    </div>
    <div class="ilx-mosaic-note ilx-mosaic-note--warning" data-ref="importReport" hidden></div>
    <ul class="ilx-mosaic-thumbs" data-ref="thumbs" aria-label="${e(t('sources.listLabel'))}" hidden></ul>
    <div class="ilx-mosaic-actions" data-ref="sourcesActions" hidden>
      <button type="button" class="ilx-mosaic-link" data-ref="sourcesRemoveAll">${e(t('sources.removeAll'))}</button>
    </div>
    <input type="file" accept="${ACCEPT}" multiple data-ref="sourcesInput" hidden>
    ${nav(1, 3, t('steps.nextTo', { name: names[2] }))}
  </section>`;

  const step3 = `<!-- Step 3: size -->
  <section class="ilx-mosaic-panel" data-panel="3" aria-labelledby="ilx-mosaic-step-3-title"${hidden}>
    ${panelTitle(3, t('size.title'))}
    ${errorBox(3)}
    <p class="ilx-mosaic-help ilx-mosaic-panel__intro">${e(t('size.help'))}</p>
    <fieldset class="ilx-mosaic-sizebox">
      <legend class="ilx-mosaic-sizebox__title">${e(t('size.boxTitle'))}</legend>
      <div class="ilx-mosaic-sizebox__fields">
        <div class="ilx-mosaic-field">
          <label class="ilx-mosaic-fieldlabel" for="ilx-mosaic-width">${e(t('size.width'))}<span class="ilx-mosaic-visually-hidden"> (${e(t('size.unit'))})</span></label>
          <div class="ilx-mosaic-inputunit">
            <input class="ilx-mosaic-input" id="ilx-mosaic-width" data-ref="widthCm" type="text" inputmode="decimal" autocomplete="off"
              aria-describedby="ilx-mosaic-width-error ilx-mosaic-size-limits">
            <span class="ilx-mosaic-inputunit__unit" aria-hidden="true">${e(t('size.unit'))}</span>
          </div>
          <p class="ilx-mosaic-fielderror" id="ilx-mosaic-width-error" data-ref="widthError" hidden></p>
        </div>
        <span class="ilx-mosaic-sizebox__times" aria-hidden="true">×</span>
        <div class="ilx-mosaic-field">
          <label class="ilx-mosaic-fieldlabel" for="ilx-mosaic-height">${e(t('size.height'))}<span class="ilx-mosaic-visually-hidden"> (${e(t('size.unit'))})</span></label>
          <div class="ilx-mosaic-inputunit">
            <input class="ilx-mosaic-input" id="ilx-mosaic-height" data-ref="heightCm" type="text" inputmode="decimal" autocomplete="off"
              aria-describedby="ilx-mosaic-height-error ilx-mosaic-size-limits">
            <span class="ilx-mosaic-inputunit__unit" aria-hidden="true">${e(t('size.unit'))}</span>
          </div>
          <p class="ilx-mosaic-fielderror" id="ilx-mosaic-height-error" data-ref="heightError" hidden></p>
        </div>
      </div>
      <label class="ilx-mosaic-check">
        <input type="checkbox" data-ref="lock" aria-describedby="ilx-mosaic-lock-help">
        <span>${e(t('size.lock'))}</span>
      </label>
      <p class="ilx-mosaic-help ilx-mosaic-check__help" id="ilx-mosaic-lock-help" data-ref="lockHelp">${e(t('size.lockHelp'))}</p>
      <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--secondary ilx-mosaic-btn--small" data-ref="swapSize" hidden>${ICONS.swap}${e(t('size.swap'))}</button>
    </fieldset>
    <ul class="ilx-mosaic-infolist">
      <li id="ilx-mosaic-size-limits">${ICONS.info}<span>${e(t('size.maxInfo', { min: config.print.minCm, max: config.print.maxCm }))}</span></li>
      <li>${ICONS.info}<span data-ref="qualityInfo"></span></li>
      <li>${ICONS.info}<span data-ref="tileInfo"></span></li>
    </ul>
    <p class="ilx-mosaic-sizesummary" data-ref="sizeSummary"></p>
    ${nav(2, 4, t('steps.make'))}
  </section>`;

  // The options ("Flere indstillinger"). Step layout: behind a disclosure inside step 4.
  // Workspace: always visible in the settings column, under their own heading.
  const optionsBody = `
          ${choiceGroup('logoStrength', Object.keys(opts.logoStrength), keyFor('logoStrength', config.tone.logoStrength), { legend: t('options.logoStrength.legend'), help: t('options.logoStrength.help') })}
          ${choiceGroup('photoDetail', Object.keys(opts.photoDetail), keyFor('photoDetail', config.tone.photoDetail), { legend: t('options.photoDetail.legend'), help: t('options.photoDetail.help') })}
          ${choiceGroup('toneVariation', Object.keys(opts.toneVariation), keyFor('toneVariation', config.tone.toneVariation), { legend: t('options.toneVariation.legend'), help: t('options.toneVariation.help') })}
          ${choiceGroup('repetition', ['even', 'free'], config.repetition, { legend: t('options.repetition.legend'), helpPerChoice: raw('options.repetition.help') })}
          <div data-ref="fitWrap">
            ${choiceGroup('fit', ['contain', 'cover'], config.targetFit, { legend: t('options.fit.legend'), help: t('options.fit.help'), helpPerChoice: raw('options.fit.choiceHelp') })}
          </div>
          <label class="ilx-mosaic-check ilx-mosaic-options__raw">
            <input type="checkbox" data-ref="rawToggle">
            <span>${e(t('options.rawToggle'))}</span>
          </label>

          <div class="ilx-mosaic-expert">
            <button type="button" class="ilx-mosaic-disclosure ilx-mosaic-disclosure--small" data-ref="expertToggle" aria-expanded="false" aria-controls="ilx-mosaic-expert-body">
              <span class="ilx-mosaic-disclosure__text"><span class="ilx-mosaic-disclosure__title">${e(t('options.expert'))}</span></span>
              ${ICONS.chevron}
            </button>
            <div class="ilx-mosaic-expert__body" id="ilx-mosaic-expert-body" data-ref="expertBody" hidden>
              <p class="ilx-mosaic-help">${e(t('options.expertHelp'))}</p>
              ${slider('logoStrength', 0, 100, 1, config.tone.logoStrength)}
              ${slider('photoDetail', 0, 100, 1, config.tone.photoDetail)}
              ${slider('toneVariation', 0, 100, 1, config.tone.toneVariation)}
            </div>
          </div>
          <div class="ilx-mosaic-actions">
            <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--filled ilx-mosaic-btn--small" data-ref="updateButtonBottom" hidden>${ICONS.refresh}${e(t('generate.update'))}</button>
            <button type="button" class="ilx-mosaic-link" data-ref="resetSettings">${e(t('options.reset'))}</button>
          </div>`;
  const options = `
      <div class="ilx-mosaic-options">
        <button type="button" class="ilx-mosaic-disclosure" data-ref="optionsToggle" aria-expanded="false" aria-controls="ilx-mosaic-options-body">
          <span class="ilx-mosaic-disclosure__text">
            <span class="ilx-mosaic-disclosure__title">${e(t('options.toggleShow'))}</span>
            <span class="ilx-mosaic-disclosure__sub">${e(t('options.toggleHelp'))}</span>
          </span>
          ${ICONS.chevron}
        </button>
        <div class="ilx-mosaic-options__body" id="ilx-mosaic-options-body" data-ref="optionsBody" hidden>${optionsBody}
        </div>
      </div>`;
  const optionsPanel = `<section class="ilx-mosaic-panel ilx-mosaic-options" aria-labelledby="ilx-mosaic-options-title">
      <${h2} class="ilx-mosaic-panel__title" id="ilx-mosaic-options-title"><span class="ilx-mosaic-panel__name">${e(t('workspace.settingsTitle'))}</span></${h2}>
      <p class="ilx-mosaic-help ilx-mosaic-panel__intro">${e(t('options.toggleHelp'))}</p>
      <div class="ilx-mosaic-options__body" id="ilx-mosaic-options-body" data-ref="optionsBody">${optionsBody}
      </div>
    </section>`;

  const startOver = `<button type="button" class="ilx-mosaic-link" data-ref="startOver">${e(t('steps.startOver'))}</button>`;

  // Workspace only: what is still missing before the first mosaic can be made.
  const waiting = ws ? `
    <div class="ilx-mosaic-wsempty" data-ref="wsEmpty">
      <p class="ilx-mosaic-wsempty__title">${e(t('workspace.emptyTitle'))}</p>
      <ul class="ilx-mosaic-infolist">
        <li>${ICONS.info}<span data-ref="wsTargetState"></span></li>
        <li>${ICONS.info}<span data-ref="wsSourcesState"></span></li>
      </ul>
    </div>` : '';

  const step4 = `<!-- Step 4: the mosaic -->
  <section class="ilx-mosaic-panel" data-panel="4" aria-labelledby="ilx-mosaic-step-4-title"${hidden}>
    ${panelTitle(4, t('generate.title'))}${ws ? `
    <p class="ilx-mosaic-help ilx-mosaic-panel__intro">${e(t('workspace.autoNote'))}</p>` : ''}${waiting}
    <div class="ilx-mosaic-working" data-ref="working" hidden>
      <p class="ilx-mosaic-working__title" id="ilx-mosaic-working-title">${ICONS.spinner}${e(t('generate.working'))}</p>
      <p class="ilx-mosaic-help">${e(t('generate.workingHelp'))}</p>
      <div class="ilx-mosaic-progress__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-labelledby="ilx-mosaic-working-title" data-ref="renderBar">
        <div class="ilx-mosaic-progress__fill" data-ref="renderFill"></div>
      </div>
      <p class="ilx-mosaic-progress__text" data-ref="renderText"></p>
      <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--secondary ilx-mosaic-btn--small" data-ref="cancel">${e(t('generate.cancel'))}</button>
    </div>
    <div class="ilx-mosaic-note ilx-mosaic-note--danger" data-ref="renderError" role="alert" hidden></div>
    <div class="ilx-mosaic-actions" data-ref="retry" hidden>
      <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--filled" data-ref="retryButton">${ICONS.refresh}${e(t('generate.again'))}</button>
    </div>

    <div class="ilx-mosaic-result" data-ref="result" hidden>
      <p class="ilx-mosaic-note ilx-mosaic-note--success" data-ref="readyNote">${ICONS.checkCircle}<span data-ref="readyText"></span></p>
      <div class="ilx-mosaic-note ilx-mosaic-note--warning ilx-mosaic-stale" data-ref="staleNote" hidden>
        <p>${e(t('generate.stale'))}</p>
        <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--filled ilx-mosaic-btn--small" data-ref="updateButton">${ICONS.refresh}${e(t('generate.update'))}</button>
      </div>

      <div class="ilx-mosaic-viewer" data-ref="viewer">
        <div class="ilx-mosaic-viewer__main">
          <div class="ilx-mosaic-viewer__toolbar" role="group" aria-label="${e(t('viewer.zoom'))}">
            <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--secondary ilx-mosaic-btn--small" data-ref="zoomOut">${ICONS.minus}${e(t('viewer.zoomOut'))}</button>
            <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--secondary ilx-mosaic-btn--small" data-ref="zoomIn">${ICONS.plus}${e(t('viewer.zoomIn'))}</button>
            <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--secondary ilx-mosaic-btn--small" data-ref="zoomFit">${ICONS.fit}${e(t('viewer.zoomFit'))}</button>
            <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--secondary ilx-mosaic-btn--small" data-ref="fullscreen">${ICONS.fullscreen}<span data-ref="fullscreenText">${e(t('viewer.fullscreen'))}</span></button>
            <span class="ilx-mosaic-viewer__zoomvalue" data-ref="zoomValue" aria-live="off"></span>
          </div>
          <div class="ilx-mosaic-stage" data-ref="stage">
            <span class="ilx-mosaic-rawlabel" data-ref="rawLabel" hidden>${e(t('viewer.rawLabel'))}</span>
            <canvas class="ilx-mosaic-canvas" data-ref="canvas" tabindex="0" role="img"></canvas>
            <div class="ilx-mosaic-tooltip" data-ref="tooltip" aria-hidden="true" hidden></div>
            <div class="ilx-mosaic-updating" data-ref="updating" hidden>
              <p class="ilx-mosaic-updating__box">${ICONS.spinner}<span data-ref="updatingText"></span></p>
            </div>
          </div>
        </div>
        <aside class="ilx-mosaic-viewer__side">
          <div class="ilx-mosaic-viewer__far">
            <p class="ilx-mosaic-fieldlabel">${e(t('viewer.far'))}</p>
            <canvas class="ilx-mosaic-far" data-ref="far" width="220" height="308" aria-hidden="true"></canvas>
            <p class="ilx-mosaic-help ilx-mosaic-small">${e(t('viewer.farHelp'))}</p>
          </div>
          <div class="ilx-mosaic-viewer__help">
            <${h3} class="ilx-mosaic-fieldlabel">${e(t('viewer.howTo'))}</${h3}>
            <ul class="ilx-mosaic-hints">
              <li class="ilx-mosaic-hint--mouse">${e(t('viewer.hintMouse'))}</li>
              <li class="ilx-mosaic-hint--touch">${e(t('viewer.hintTouch'))}</li>
              <li>${e(t('viewer.hintClick'))}</li>
              <li>${e(t('viewer.hintKeys'))}</li>
            </ul>
            <p class="ilx-mosaic-help ilx-mosaic-small" data-ref="quality"></p>
          </div>
        </aside>
      </div>

      <div class="ilx-mosaic-tilesize">
        <div class="ilx-mosaic-slider">
          <div class="ilx-mosaic-slider__head">
            <label class="ilx-mosaic-fieldlabel" for="ilx-mosaic-tilesize">${e(t('tileSize.label'))}</label>
            <output class="ilx-mosaic-slider__value" data-ref="tileSizeValue" for="ilx-mosaic-tilesize"></output>
          </div>
          <input class="ilx-mosaic-range" type="range" id="ilx-mosaic-tilesize" data-ref="tileSizeSlider" aria-describedby="ilx-mosaic-tilesize-help ilx-mosaic-tilesize-count">
        </div>
        <p class="ilx-mosaic-help" id="ilx-mosaic-tilesize-help">${e(t('tileSize.help'))}</p>
        <p class="ilx-mosaic-help ilx-mosaic-small" id="ilx-mosaic-tilesize-count" data-ref="tileSizeCount"></p>
      </div>

      <div class="ilx-mosaic-downloads">
        <${h3} class="ilx-mosaic-sectiontitle">${e(t('next.title'))}</${h3}>
        <div class="ilx-mosaic-downloads__item">
          <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--buy" data-ref="continueButton" aria-describedby="ilx-mosaic-continue-help">${e(t('next.button'))}${ICONS.arrowRight}</button>
          <p class="ilx-mosaic-help" id="ilx-mosaic-continue-help" data-ref="continueHelp"></p>
        </div>
        <p class="ilx-mosaic-note" data-ref="continueStatus" hidden></p>
      </div>
${ws ? '' : options}
    </div>
${ws ? '' : `
    <div class="ilx-mosaic-stepnav">
      <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--secondary" data-prev="3">${ICONS.arrowLeft}${e(t('steps.back'))}</button>
      ${startOver}
    </div>`}
  </section>`;

  const dialogs = `<dialog class="ilx-mosaic-dialog" data-ref="inspector" aria-labelledby="ilx-mosaic-inspector-title">
    <div class="ilx-mosaic-dialog__head">
      <${h2} class="ilx-mosaic-dialog__title" id="ilx-mosaic-inspector-title" data-ref="inspectorTitle">${e(t('inspector.title'))}</${h2}>
      <button type="button" class="ilx-mosaic-close" data-ref="inspectorClose">${e(t('inspector.close'))}${ICONS.close}</button>
    </div>
    <div class="ilx-mosaic-dialog__body">
      <div class="ilx-mosaic-compare">
        <figure><canvas data-ref="inspectOriginal" width="512" height="512" aria-hidden="true"></canvas><figcaption>${e(t('inspector.original'))}</figcaption></figure>
        <figure><canvas data-ref="inspectAdjusted" width="512" height="512" aria-hidden="true"></canvas><figcaption data-ref="inspectAdjustedCaption">${e(t('inspector.adjusted'))}</figcaption></figure>
      </div>
      <p data-ref="inspectInfo"></p>
      <p class="ilx-mosaic-help" data-ref="inspectSmall" hidden>${e(t('inspector.smallSource'))}</p>
      <button type="button" class="ilx-mosaic-disclosure ilx-mosaic-disclosure--small" data-ref="fillToggle" aria-expanded="false" aria-controls="ilx-mosaic-fill-body">
        <span class="ilx-mosaic-disclosure__text"><span class="ilx-mosaic-disclosure__title">${e(t('inspector.fillToggle'))}</span></span>
        ${ICONS.chevron}
      </button>
      <div class="ilx-mosaic-fill" id="ilx-mosaic-fill-body" data-ref="fillBody" hidden>
        <p class="ilx-mosaic-help">${e(t('inspector.fillHelp'))}</p>
        <fieldset class="ilx-mosaic-choices">
          <legend class="ilx-mosaic-choices__legend">${e(t('inspector.fill'))}</legend>
          <div class="ilx-mosaic-choices__list ilx-mosaic-choices__list--compact">
            ${['auto', 'white', 'black', 'custom'].map(key => `
            <label class="ilx-mosaic-choice">
              <input type="radio" name="ilx-mosaic-fill" value="${key}" data-fill-mode>
              <span class="ilx-mosaic-choice__text">${e(t('inspector.fill' + key[0].toUpperCase() + key.slice(1)))}</span>
            </label>`).join('')}
          </div>
        </fieldset>
        <div class="ilx-mosaic-field ilx-mosaic-fill__color" data-ref="fillColorWrap" hidden>
          <label class="ilx-mosaic-fieldlabel" for="ilx-mosaic-fill-color">${e(t('inspector.fillColor'))}</label>
          <input class="ilx-mosaic-input ilx-mosaic-input--color" type="color" id="ilx-mosaic-fill-color" data-ref="fillColor">
        </div>
        <p class="ilx-mosaic-help" data-ref="fillDetected"></p>
        <p class="ilx-mosaic-help">${e(t('inspector.fillScope'))}</p>
        <p class="ilx-mosaic-note ilx-mosaic-note--danger" data-ref="fillError" role="alert" hidden></p>
        <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--filled ilx-mosaic-btn--small" data-ref="fillApply">${e(t('inspector.fillApply'))}</button>
      </div>
    </div>
    <div class="ilx-mosaic-dialog__foot">
      <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--secondary ilx-mosaic-btn--small" data-ref="zoomHere">${e(t('inspector.zoomHere'))}</button>
    </div>
  </dialog>

  <dialog class="ilx-mosaic-dialog ilx-mosaic-dialog--small" data-ref="confirm" aria-labelledby="ilx-mosaic-confirm-title" aria-describedby="ilx-mosaic-confirm-text">
    <div class="ilx-mosaic-dialog__head"><${h2} class="ilx-mosaic-dialog__title" id="ilx-mosaic-confirm-title" data-ref="confirmTitle"></${h2}></div>
    <div class="ilx-mosaic-dialog__body"><div id="ilx-mosaic-confirm-text" data-ref="confirmText"></div></div>
    <div class="ilx-mosaic-dialog__foot ilx-mosaic-actions">
      <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--filled ilx-mosaic-btn--small" data-ref="confirmOk"></button>
      <button type="button" class="ilx-mosaic-btn ilx-mosaic-btn--secondary ilx-mosaic-btn--small" data-ref="confirmCancel"></button>
    </div>
  </dialog>`;

  if (ws) {
    return `
<div class="ilx-mosaic-app ilx-mosaic-app--workspace">
  ${header}
  ${live}
  <div class="ilx-mosaic-workspace">
    <div class="ilx-mosaic-workspace__col ilx-mosaic-workspace__col--images">
  ${step1}
  ${step2}
    </div>
    <div class="ilx-mosaic-workspace__col ilx-mosaic-workspace__col--mosaic">
  ${step4}
    </div>
    <div class="ilx-mosaic-workspace__col ilx-mosaic-workspace__col--settings">
  ${step3}
    ${optionsPanel}
    <div class="ilx-mosaic-actions">${startOver}</div>
    </div>
  </div>

  ${dialogs}
</div>`;
  }

  return `
<div class="ilx-mosaic-app">
  ${header}

  ${stepList}

  ${live}

  ${step1}

  ${step2}

  ${step3}

  ${step4}

  ${dialogs}
</div>`;
}
