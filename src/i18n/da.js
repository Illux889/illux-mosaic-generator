/**
 * Illux Mosaik — Danish UI texts. ALL customer-facing strings live here.
 *
 * Writing rules (accessibility): talk to the customer as "du", short sentences,
 * one idea per sentence, everyday words. Avoid technical terms (pixel, DPI,
 * grid, tone curve); where a number is needed, explain it in plain words first.
 *
 * To add Norwegian/Swedish: copy this file to no.js / sv.js, translate the
 * values (keep the keys and {placeholders}), and register it in i18n/index.js.
 */
export default {
  locale: 'da-DK',

  app: {
    title: 'Lav din egen fotomosaik',
    intro: 'Byg ét stort billede af mange af dine egne billeder. Du kan hente det færdige resultat som en printfil.',
    privacy: 'Dine billeder bliver på din egen computer eller telefon. Intet bliver sendt til os eller andre.',
    unsupported: 'Din browser kan desværre ikke lave mosaikker. Prøv med en opdateret udgave af Chrome, Edge, Firefox eller Safari.',
    blockedEmbed: 'Mosaikgeneratoren kan kun bruges på illux.dk.',
    blockedLink: 'Gå til illux.dk'
  },

  steps: {
    nav: 'Trin',
    progress: 'Trin {current} af {total}',
    stepLabel: 'Trin {number}: {name}',
    done: 'færdig',
    current: 'du er her',
    names: ['Hovedbillede', 'Dine billeder', 'Størrelse', 'Din mosaik'],
    back: 'Tilbage',
    next: 'Næste',
    nextTo: 'Næste: {name}',
    make: 'Lav min mosaik',
    startOver: 'Start forfra',
    startOverConfirm: 'Vil du starte forfra? Dit hovedbillede, dine billeder og din mosaik bliver fjernet.',
    startOverYes: 'Ja, start forfra',
    startOverNo: 'Nej, fortsæt'
  },

  errorSummary: {
    title: 'Der mangler noget',
    target: 'Vælg et hovedbillede.',
    sources: 'Tilføj mindst {min} billeder.',
    importing: 'Vent, til dine billeder er indlæst.',
    size: 'Skriv en bredde og en højde mellem {min} og {max} cm.'
  },

  target: {
    title: 'Vælg dit hovedbillede',
    help: 'Det er det billede, mosaikken skal ligne. Vælg gerne et billede med et tydeligt motiv, fx et portræt, et dyr eller et logo.',
    choose: 'Upload hovedbillede',
    drop: 'eller træk billedet herind',
    formats: 'Du kan bruge billeder i JPG, PNG eller WebP.',
    loading: 'Indlæser billedet …',
    chosen: 'Dit hovedbillede',
    replace: 'Vælg et andet billede',
    remove: 'Fjern billedet',
    previewAlt: 'Dit hovedbillede: {name}',
    info: '{name}'
  },

  sources: {
    title: 'Tilføj dine billeder',
    help: 'Det er de små billeder, som mosaikken bliver bygget af. Jo flere forskellige billeder, jo flottere bliver resultatet.',
    advice: 'Vi anbefaler mindst {min} billeder. Gerne {good} eller flere.',
    choose: 'Upload billeder',
    chooseMore: 'Tilføj flere billeder',
    drop: 'eller træk billederne herind',
    formats: 'Du kan vælge mange billeder på én gang. JPG, PNG eller WebP.',
    listLabel: 'Dine valgte billeder',
    count: 'Du har valgt {count} billeder.',
    countOne: 'Du har valgt 1 billede.',
    countNone: 'Du har ikke valgt nogen billeder endnu.',
    level: {
      few: 'Det er lidt få. Mosaikken kan godt laves, men de samme billeder bliver gentaget mange gange.',
      ok: 'Det er fint. Flere billeder giver mere variation.',
      good: 'Det er rigtig godt. Mosaikken får masser af variation.'
    },
    removeOne: 'Fjern {name}',
    removeAll: 'Fjern alle billeder',
    removeAllConfirm: 'Vil du fjerne alle {count} billeder?',
    removeAllYes: 'Ja, fjern alle',
    removeAllNo: 'Nej, behold dem',
    removed: '{name} er fjernet.',
    removedAll: 'Alle billeder er fjernet.',
    importing: 'Indlæser dine billeder: {done} af {total}',
    importStop: 'Stop indlæsningen',
    importStopped: 'Indlæsningen er stoppet. De billeder, der nåede at blive indlæst, er gemt.',
    importDone: '{count} billeder er tilføjet.',
    importDoneOne: '1 billede er tilføjet.',
    maxReached: 'Du kan højst bruge {max} billeder. De sidste {count} blev ikke tilføjet.',
    duplicates: '{count} billeder var der allerede, så de blev sprunget over.',
    duplicatesOne: '1 billede var der allerede, så det blev sprunget over.',
    rejectedTitle: '{count} billeder kunne ikke bruges:',
    rejectedOne: '1 billede kunne ikke bruges:',
    showMore: 'Vis alle',
    showLess: 'Vis færre'
  },

  errors: {
    'too-large': 'Filen er for stor. Den må højst fylde {mb} MB.',
    heic: 'Billedet er i iPhone-formatet HEIC, som ikke kan bruges her. Vælg billedet igen fra Fotos-appen. Så laver iPhonen det normalt om til JPG.',
    unsupported: 'Det er ikke et billede, vi kan bruge. Vælg en JPG-, PNG- eller WebP-fil.',
    'decode-failed': 'Billedet kunne ikke åbnes. Filen kan være ødelagt.',
    'decode-timeout': 'Det tog for lang tid at åbne billedet.',
    'too-many-megapixels': 'Billedet er for stort (over {mp} millioner punkter).',
    'too-small': 'Billedet er for lille. Det skal være mindst {px} punkter på den korte led.',
    'target-too-small': 'Billedet er for lille til et hovedbillede. Det skal være mindst {px} punkter på den korte led.',
    'bad-dimensions': 'Billedet kunne ikke åbnes.',
    'encode-failed': 'Billedet kunne ikke behandles.',
    'no-target': 'Vælg først et hovedbillede.',
    'too-few-sources': 'Tilføj mindst {min} billeder.',
    'unsupported-browser': 'Din browser kan desværre ikke lave mosaikker. Prøv med en opdateret udgave af Chrome, Edge, Firefox eller Safari.',
    'too-much-memory': 'Det er for mange billeder til din enhed i denne størrelse. Vælg "Færre og større felter" under "Flere indstillinger", eller brug færre billeder.',
    'too-many-for-grid': 'Du har {photos} billeder, men mosaikken har kun plads til {cells}. Vælg "Flere og mindre felter" under "Flere indstillinger", eller fjern nogle billeder.',
    'worker-blocked': 'Browseren stoppede beregningen. Prøv at genindlæse siden.',
    'worker-failed': 'Beregningen stoppede. Måske løb din enhed tør for hukommelse. Prøv med færre billeder.',
    'iteration-limit': 'Beregningen blev for tung. Prøv med færre billeder.',
    'print-unsupported': 'Din browser kan ikke lave printfilen. Prøv med en opdateret Chrome, Edge, Firefox eller Safari.',
    'print-failed': 'Printfilen kunne ikke laves. Måske løb din enhed tør for hukommelse. Prøv på en computer.',
    'source-missing': 'Et af billederne findes ikke længere. Lav mosaikken igen.',
    'detail-unsupported': 'Din browser kan ikke vise billederne skarpt, når du zoomer.',
    'detail-failed': 'Et billede kunne ikke vises skarpt.',
    'bad-fill': 'Vælg en gyldig farve.',
    generic: 'Noget gik galt. Prøv igen.'
  },

  size: {
    title: 'Vælg størrelse',
    help: 'Hvor stor skal mosaikken være, når den er printet?',
    boxTitle: 'Størrelse i centimeter',
    width: 'Bredde',
    height: 'Højde',
    unit: 'cm',
    times: 'gange',
    lock: 'Lås proportioner',
    lockHelp: 'Når den er slået til, får mosaikken samme form som dit hovedbillede. Du skriver bare bredden.',
    lockNoTarget: 'Vælg et hovedbillede for at kunne låse proportionerne.',
    swap: 'Byt om på bredde og højde',
    invalid: 'Skriv et tal mellem {min} og {max} cm.',
    lockedTooBig: 'Med låste proportioner bliver {side} {value} cm. Den skal være mellem {min} og {max} cm. Skriv en anden størrelse.',
    sideWidth: 'bredden',
    sideHeight: 'højden',
    maxInfo: 'Mindst {min} cm og højst {max} cm på hver led.',
    summary: 'Mosaikken bliver {width} × {height} cm.',
    qualityHigh: 'Printkvalitet: Meget høj (250 DPI). Godt til billeder, man ser tæt på.',
    qualityNormal: 'Printkvalitet: Høj (150 DPI). Godt til store billeder, man ser på lidt afstand.',
    tile: 'Hvert lille billede bliver ca. {cm} cm bredt.'
  },

  generate: {
    title: 'Din mosaik',
    working: 'Vi laver din mosaik …',
    updating: 'Opdaterer mosaikken … {percent} %',
    workingHelp: 'Det tager som regel under et minut. Lad siden være åben imens.',
    cancel: 'Annullér',
    cancelled: 'Du annullerede. Tryk på "Lav mosaikken igen", når du er klar.',
    again: 'Lav mosaikken igen',
    ready: 'Din mosaik er klar.',
    readyDetail: 'Den er lavet af {used} billeder i {cells} felter.',
    unused: '{count} af dine billeder kom ikke med, fordi andre passede bedre.',
    stale: 'Du har ændret noget. Tryk på "Opdater mosaikken" for at se ændringen.',
    update: 'Opdater mosaikken',
    progressLabel: 'Fremskridt',
    stages: {
      analyserer: 'Ser på farver og lys i dine billeder',
      sammenligner: 'Sammenligner dine billeder med hovedbilledet',
      matcher: 'Finder den bedste plads til hvert billede',
      spreder: 'Spreder ens billeder ud',
      toner: 'Tilpasser lys og farver'
    }
  },

  viewer: {
    zoomIn: 'Zoom ind',
    zoomOut: 'Zoom ud',
    zoomFit: 'Vis hele',
    zoom: 'Zoom',
    zoomValue: 'Zoom: {value} %',
    fullscreen: 'Fuld skærm',
    exitFullscreen: 'Luk fuld skærm',
    rawOn: 'Vis billederne uden farvetilpasning',
    rawLabel: 'Vist uden farvetilpasning',
    far: 'Hele mosaikken',
    farHelp: 'Klik i den lille udgave for at hoppe til et sted.',
    howTo: 'Sådan ser du detaljer',
    hintMouse: 'Zoom med knapperne eller musens hjul. Træk i billedet for at flytte rundt.',
    hintTouch: 'Zoom med to fingre. Træk med én finger for at flytte rundt.',
    hintKeys: 'Med tastaturet: plus og minus zoomer, piletasterne flytter, og Enter viser billedet i midten.',
    hintClick: 'Klik på et lille billede for at se det i stor størrelse.',
    qualityOverview: 'Zoom ind for at se de små billeder skarpt.',
    qualityLoading: 'Henter skarpe billeder …',
    qualityReady: 'De små billeder vises skarpt.',
    qualityUnavailable: 'Her vises en mindre skarp udgave.',
    tooltip: '{name} · bruges {count} gange',
    canvasLabel: 'Din fotomosaik, lavet af {count} billeder. Plus og minus zoomer, piletasterne flytter, Enter viser billedet i midten.'
  },

  inspector: {
    title: 'Billede i mosaikken',
    close: 'Luk',
    original: 'Dit billede',
    adjusted: 'Sådan ser det ud i mosaikken',
    adjustedRaw: 'Sådan ser det ud i mosaikken (uden farvetilpasning)',
    info: 'Det her billede bruges {count} gange i mosaikken.',
    smallSource: 'Billedet er lille, så det kan se lidt uskarpt ud i stor størrelse.',
    fillToggle: 'Skift farven rundt om billedet',
    fill: 'Farve rundt om billedet',
    fillHelp: 'Vi skærer aldrig dine billeder til. Er et billede ikke kvadratisk, fylder vi den tomme plads ud med en farve. Normalt finder vi farven automatisk.',
    fillAuto: 'Automatisk (anbefalet)',
    fillWhite: 'Hvid',
    fillBlack: 'Sort',
    fillCustom: 'Vælg selv en farve',
    fillColor: 'Din farve',
    fillApply: 'Brug farven',
    fillScope: 'Farven bruges alle steder, hvor billedet er med.',
    fillWorking: 'Laver mosaikken igen med den nye farve …',
    zoomHere: 'Vis i mosaikken'
  },

  tileSize: {
    label: 'Størrelse på de små billeder',
    value: '{cm} cm',
    help: 'Træk for at gøre de små billeder større eller mindre. Mosaikken bliver opdateret af sig selv. Med større billeder bliver hovedbilledet mindre skarpt.',
    count: 'Mosaikken får {cols} × {rows} små billeder.'
  },

  next: {
    title: 'Næste skridt',
    button: 'Fortsæt til produkt',
    help: 'Vælg materiale, og se din mosaik på produktet. Din mosaik er {width} × {height} cm.',
    soon: 'Produktsiden kommer snart. Her kan du vælge materiale og se din mosaik på produktet.',
    stale: 'Tryk på "Opdater mosaikken", før du fortsætter.'
  },

  options: {
    toggleShow: 'Flere indstillinger',
    toggleHelp: 'Tilpas udseendet, hvis du har lyst. Mosaikken ser fin ud uden.',
    logoStrength: {
      legend: 'Hvor meget skal billederne tilpasse sig hovedbilledet?',
      help: 'Mere tilpasning gør hovedbilledet tydeligere. Mindre tilpasning bevarer dine billeders egne farver og lys.',
      choices: { low: 'Lidt', medium: 'Noget', high: 'Meget (anbefalet)' }
    },
    photoDetail: {
      legend: 'Hvor tydelige skal de små billeder være?',
      help: 'Tydelige små billeder er sjove at kigge på tæt på. Et roligt udtryk gør hovedbilledet tydeligere på afstand.',
      choices: { calm: 'Roligt udtryk', medium: 'Mellem', clear: 'Tydelige billeder (anbefalet)' }
    },
    toneVariation: {
      legend: 'Hvilke farver skal mosaikken have?',
      help: 'Vælg om farverne skal følge hovedbilledet, eller om dine billeder skal beholde deres egne farver.',
      choices: { target: 'Hovedbilledets farver (anbefalet)', some: 'Lidt af billedernes egne farver', own: 'Mest billedernes egne farver' }
    },
    repetition: {
      legend: 'Hvor ofte må det samme billede bruges?',
      choices: { even: 'Alle billeder lige mange gange (anbefalet)', free: 'Det billede, der passer bedst' },
      help: {
        even: 'Alle dine billeder kommer med, og ens billeder bliver spredt ud.',
        free: 'Hovedbilledet bliver skarpere, men nogle billeder bruges mange gange og andre måske slet ikke.'
      }
    },
    fit: {
      legend: 'Hvordan skal hovedbilledet placeres?',
      help: 'Det betyder kun noget, når mosaikken har en anden form end hovedbilledet.',
      choices: { contain: 'Vis hele hovedbilledet (anbefalet)', cover: 'Fyld hele mosaikken ud' },
      choiceHelp: {
        contain: 'Kanterne fyldes ud med en blød udgave af billedet.',
        cover: 'Kanterne af hovedbilledet kan blive skåret af.'
      }
    },
    expert: 'Finjuster med skydeknapper',
    expertHelp: 'Til dig, der vil styre detaljerne selv. Værdien går fra 0 til 100.',
    sliders: {
      logoStrength: 'Tilpasning til hovedbilledet',
      photoDetail: 'Tydelighed af de små billeder',
      toneVariation: 'Billedernes egne farver'
    },
    custom: 'Egen indstilling',
    reset: 'Brug de anbefalede indstillinger',
    rawToggle: 'Sammenlign med billederne uden farvetilpasning'
  },

  units: {
    percent: '{value} %'
  },

  // Only used by the one-screen layout (version 3 "Værkstedet").
  workspace: {
    title: 'Lav din egen fotomosaik',
    intro: 'Alt er samlet på én side. Vælg dine billeder til venstre, se mosaikken i midten, og ret størrelse og udseende til højre.',
    settingsTitle: 'Udseende',
    autoNote: 'Mosaikken opdaterer sig selv, når du ændrer noget.',
    emptyTitle: 'Din mosaik vises her, når du har valgt:',
    targetMissing: 'Et hovedbillede. Det mangler stadig.',
    targetDone: 'Et hovedbillede. Det har du valgt.',
    sources: 'Mindst {min} billeder. Du har valgt {count}.',
    updated: 'Mosaikken er opdateret.',
    wait: 'Vent et øjeblik. Mosaikken bliver opdateret med dine ændringer.'
  }
};
