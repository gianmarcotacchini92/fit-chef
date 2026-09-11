import type { Equipment, Preferences, Recipe } from "./types";

export type Slot = {
  role: string;
  ids: string[];
  min: number;
  max: number;
  ideal: number;
  required: boolean;
  maxChoices: number;
};

export type Ratio = { numerator: string; denominator: string; min: number; max: number };

export type Template = {
  id: string;
  title: string;
  description: string;
  family: Recipe["family"];
  cuisine: string;
  technique: string;
  taste: "savory" | "sweet";
  meals: Preferences["meal"][];
  equipment: Equipment[];
  minutes: number;
  extraServingMinutes: number;
  difficulty: "easy" | "medium";
  mealPrep: boolean;
  slots: Slot[];
  ratios: Ratio[];
};

function slot(
  role: string, ids: string[], min: number, max: number, ideal: number,
  required = true, maxChoices = 1,
): Slot {
  return { role, ids, min, max, ideal, required, maxChoices };
}

const cookedVegetables = ["zucchini", "broccoli", "spinach", "carrot", "bell-pepper", "peas", "tomato"];
const rawVegetables = ["tomato", "cucumber", "carrot", "bell-pepper", "spinach"];
const dairy = ["greek-yogurt", "skyr"];
const fruit = ["banana", "strawberries", "berries", "apple"];
const oil = slot("olio", ["olive-oil"], 1, 15, 5, false);
const acid = slot("acidità", ["lemon"], 3, 25, 10, false);
const salt = slot("sale", ["salt"], 0.2, 1.5, 0.5, false);
const spice = slot("spezie", ["paprika"], 0.5, 2, 0.5, false);
const sweetSpice = slot("aroma", ["cinnamon"], 0.2, 1, 0.5, false);
const nuts = slot("guarnizione", ["almonds", "walnuts", "peanut-butter", "sesame"], 5, 25, 10, false);
const whey = slot("proteine in polvere", ["whey"], 5, 30, 15, false);
const honey = slot("dolcificante", ["honey"], 3, 15, 5, false);
const savoryMeals: Preferences["meal"][] = ["lunch", "dinner"];
const sweetMeals: Preferences["meal"][] = ["breakfast", "snack", "dessert"];
const coffee = slot("bevanda", ["coffee"], 5, 600, 30, false);
const breadSide = slot("pane", ["bread"], 10, 180, 70, false);
const fishChefExtras = [
  slot("crema", ["greek-yogurt"], 10, 100, 40, false),
  slot("acidità", ["lemon"], 3, 25, 15, false),
  slot("spezie", ["paprika"], 0.5, 2, 1, false), oil, salt,
];

export const TEMPLATES: Template[] = [
  {
    id: "one-pan-rice", title: "Riso in padella con verdure",
    description: "Riso cotto per assorbimento con bocconcini e verdure, non riso già cotto pesato a secco.",
    family: "bowl", cuisine: "mediterranea", technique: "rosolatura e assorbimento",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove"],
    minutes: 32, extraServingMinutes: 3, difficulty: "easy", mealPrep: true,
    slots: [
      slot("cereale", ["rice", "quinoa"], 35, 100, 65),
      slot("proteina", ["chicken", "turkey", "tofu"], 75, 220, 140),
      slot("verdure", cookedVegetables, 60, 260, 150, true, 2),
      slot("salsa", dairy, 20, 120, 40, false), oil, acid, spice, salt,
    ],
    ratios: [{ numerator: "verdure", denominator: "cereale", min: 1, max: 5 }],
  },
  {
    id: "poached-rice-salad", title: "Insalata tiepida di riso con crema allo yogurt",
    description: "Cottura delicata in acqua e condimento cremoso fuori dal fuoco, senza rosolatura.",
    family: "salad", cuisine: "mediterranea", technique: "lessatura e condimento allo yogurt",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove"],
    minutes: 29, extraServingMinutes: 3, difficulty: "easy", mealPrep: true,
    slots: [
      slot("cereale", ["rice", "quinoa"], 35, 95, 65),
      slot("proteina", ["chicken", "turkey", "tuna", "chickpeas", "tofu"], 75, 210, 140),
      slot("verdure", ["zucchini", ...rawVegetables], 60, 250, 150, true, 2),
      slot("salsa", dairy, 40, 150, 70), oil, acid, spice, salt,
    ],
    ratios: [
      { numerator: "salsa", denominator: "cereale", min: 0.6, max: 2.5 },
      { numerator: "verdure", denominator: "cereale", min: 1, max: 4 },
    ],
  },
  {
    id: "oat-egg-crepe", title: "Crêpe di avena e uovo con ripieno fresco",
    description: "Una vera pastella di avena con uovo legante, cotta sottile e farcita.",
    family: "wrap", cuisine: "casalinga", technique: "pastella sottile in padella",
    taste: "savory", meals: ["breakfast", ...savoryMeals], equipment: ["blender", "pan", "stove"],
    minutes: 23, extraServingMinutes: 6, difficulty: "medium", mealPrep: false,
    slots: [
      slot("farina", ["oats"], 30, 75, 45),
      slot("legante", ["eggs"], 50, 130, 75),
      slot("ripieno", ["tuna", "tofu", "cottage-cheese", "mozzarella-light"], 40, 140, 75),
      slot("verdure", ["tomato", "spinach", "cucumber"], 30, 100, 60),
      slot("salsa", dairy, 15, 60, 30, false), oil, salt, spice,
    ],
    ratios: [
      { numerator: "legante", denominator: "farina", min: 1.2, max: 2.8 },
      { numerator: "ripieno", denominator: "farina", min: 0.7, max: 2.5 },
      { numerator: "verdure", denominator: "farina", min: 0.5, max: 2 },
    ],
  },
  {
    id: "banana-oat-pancakes", title: "Pancake di banana, avena e uovo",
    description: "Pancake piccoli e morbidi, naturalmente dolci, con uovo come legante; non richiedono lievito.",
    family: "pancakes", cuisine: "casalinga", technique: "pastella densa in padella",
    taste: "sweet", meals: sweetMeals, equipment: ["blender", "pan", "stove"],
    minutes: 20, extraServingMinutes: 5, difficulty: "easy", mealPrep: true,
    slots: [
      slot("farina", ["oats"], 25, 75, 45), slot("legante", ["eggs"], 50, 120, 65),
      slot("frutta", ["banana"], 50, 140, 90),
      slot("salsa", dairy, 30, 180, 80, false), nuts, sweetSpice, honey, oil,
    ],
    ratios: [
      { numerator: "legante", denominator: "farina", min: 1, max: 2.6 },
      { numerator: "frutta", denominator: "farina", min: 1, max: 2.4 },
    ],
  },
  {
    id: "yogurt-fruit-parfait", title: "Coppa di yogurt e frutta",
    description: "Dessert fresco a strati; i fiocchi fini sono facoltativi e non richiedono ammollo notturno.",
    family: "dessert", cuisine: "casalinga", technique: "assemblaggio a strati",
    taste: "sweet", meals: sweetMeals, equipment: [], minutes: 7,
    extraServingMinutes: 1, difficulty: "easy", mealPrep: true,
    slots: [
      slot("crema", dairy, 120, 300, 200), slot("frutta", fruit, 60, 220, 120),
      slot("cereale", ["oats"], 10, 50, 25, false), nuts, whey, sweetSpice, honey,
    ],
    ratios: [
      { numerator: "frutta", denominator: "crema", min: 0.25, max: 1.25 },
      { numerator: "cereale", denominator: "crema", min: 0, max: 0.25 },
      { numerator: "proteine in polvere", denominator: "crema", min: 0, max: 0.12 },
    ],
  },
  {
    id: "cocoa-banana-cream", title: "Crema di yogurt, banana e cacao",
    description: "Banana schiacciata e yogurt formano una crema al cucchiaio, non una mousse montata.",
    family: "dessert", cuisine: "casalinga", technique: "schiacciatura ed emulsione a freddo",
    taste: "sweet", meals: sweetMeals, equipment: [], minutes: 6,
    extraServingMinutes: 1, difficulty: "easy", mealPrep: true,
    slots: [
      slot("crema", dairy, 120, 280, 180), slot("frutta", ["banana"], 50, 140, 90),
      slot("cacao", ["cocoa"], 3, 12, 6), nuts, whey, sweetSpice, honey,
    ],
    ratios: [
      { numerator: "frutta", denominator: "crema", min: 0.25, max: 0.8 },
      { numerator: "cacao", denominator: "crema", min: 0.015, max: 0.05 },
      { numerator: "proteine in polvere", denominator: "crema", min: 0, max: 0.1 },
    ],
  },
  {
    id: "vegetable-frittata", title: "Frittata morbida di verdure",
    description: "Uova intere con verdure cotte e, se presenti, albume e formaggio.",
    family: "frittata", cuisine: "italiana", technique: "coagulazione coperta in padella",
    taste: "savory", meals: ["breakfast", ...savoryMeals], equipment: ["pan", "stove"],
    minutes: 22, extraServingMinutes: 4, difficulty: "easy", mealPrep: true,
    slots: [
      slot("uova", ["eggs"], 80, 180, 110),
      slot("albume", ["egg-whites"], 30, 180, 70, false),
      slot("verdure", cookedVegetables, 60, 220, 130, true, 2),
      slot("formaggio", ["mozzarella-light", "cottage-cheese"], 20, 70, 35, false),
      oil, spice, salt,
    ],
    ratios: [
      { numerator: "verdure", denominator: "uova", min: 0.5, max: 2 },
      { numerator: "albume", denominator: "uova", min: 0, max: 1.5 },
    ],
  },
  {
    id: "legume-crunch-salad", title: "Insalata croccante di legumi",
    description: "Legumi già cotti e sgocciolati con verdure crude e un condimento misurato.",
    family: "salad", cuisine: "mediterranea", technique: "assemblaggio crudo e cotto",
    taste: "savory", meals: savoryMeals, equipment: [], minutes: 10,
    extraServingMinutes: 2, difficulty: "easy", mealPrep: true,
    slots: [
      slot("legumi", ["chickpeas", "lentils"], 120, 280, 190),
      slot("verdure", rawVegetables, 60, 230, 140, true, 2),
      slot("aggiunta", ["tuna", "mozzarella-light", "tofu"], 40, 130, 70, false),
      slot("salsa", dairy, 20, 90, 40, false),
      slot("guarnizione", ["avocado", "sesame"], 10, 50, 20, false), oil, acid, salt, spice,
    ],
    ratios: [{ numerator: "verdure", denominator: "legumi", min: 0.5, max: 2 }],
  },
  {
    id: "tuna-vegetable-pasta", title: "Pasta al tonno e verdure",
    description: "Pasta risottata in padella con verdure; tonno già cotto aggiunto alla fine.",
    family: "pasta", cuisine: "italiana", technique: "pasta risottata",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove"],
    minutes: 23, extraServingMinutes: 3, difficulty: "easy", mealPrep: true,
    slots: [
      slot("pasta", ["pasta"], 40, 110, 75), slot("proteina", ["tuna"], 60, 180, 110),
      slot("verdure", ["tomato", "zucchini", "spinach"], 60, 220, 140, true, 2),
      slot("salsa", dairy, 20, 80, 35, false), oil, acid, spice, salt,
    ],
    ratios: [
      { numerator: "proteina", denominator: "pasta", min: 0.7, max: 2.5 },
      { numerator: "verdure", denominator: "pasta", min: 0.8, max: 3.5 },
    ],
  },
  {
    id: "legume-oat-patties", title: "Polpette schiacciate di legumi e avena",
    description: "Legumi già cotti, avena macinata e uovo: un legante reale per polpette compatte.",
    family: "patties", cuisine: "casalinga", technique: "impasto legato e doratura",
    taste: "savory", meals: savoryMeals, equipment: ["blender", "pan", "stove"],
    minutes: 27, extraServingMinutes: 5, difficulty: "medium", mealPrep: true,
    slots: [
      slot("legumi", ["chickpeas", "lentils"], 120, 240, 180),
      slot("farina", ["oats"], 20, 65, 35), slot("legante", ["eggs"], 35, 90, 55),
      slot("verdure", ["carrot", "zucchini"], 20, 70, 40, false),
      slot("salsa", dairy, 20, 100, 50, false), oil, acid, salt, spice,
    ],
    ratios: [
      { numerator: "farina", denominator: "legumi", min: 0.15, max: 0.3 },
      { numerator: "legante", denominator: "legumi", min: 0.2, max: 0.4 },
      { numerator: "verdure", denominator: "legumi", min: 0, max: 0.3 },
    ],
  },
  {
    id: "potato-protein-skillet", title: "Padellata di patate e bocconcini",
    description: "Patate a cubetti piccoli, precotte in poca acqua e finite con proteine e verdure.",
    family: "bowl", cuisine: "casalinga", technique: "stufatura e doratura di tuberi",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove"],
    minutes: 33, extraServingMinutes: 3, difficulty: "easy", mealPrep: true,
    slots: [
      slot("tubero", ["potato", "sweet-potato"], 150, 350, 240),
      slot("proteina", ["chicken", "turkey", "tofu"], 80, 220, 140),
      slot("verdure", cookedVegetables, 60, 200, 120, true, 2),
      slot("salsa", dairy, 20, 90, 40, false), oil, acid, spice, salt,
    ],
    ratios: [{ numerator: "verdure", denominator: "tubero", min: 0.25, max: 1.2 }],
  },
  {
    id: "ready-wrap", title: "Piadina integrale con ripieno fresco",
    description: "Piadina già pronta, farcita a freddo: nessuna promessa di impasto con ingredienti privi di legante.",
    family: "wrap", cuisine: "mediterranea", technique: "farcitura a freddo",
    taste: "savory", meals: savoryMeals, equipment: [], minutes: 9,
    extraServingMinutes: 2, difficulty: "easy", mealPrep: false,
    slots: [
      slot("piadina", ["whole-wheat-wrap"], 50, 100, 70),
      slot("ripieno", ["tuna", "tofu", "chickpeas", "mozzarella-light"], 60, 150, 100),
      slot("verdure", rawVegetables, 30, 110, 60),
      slot("salsa", dairy, 15, 60, 30, false),
      slot("guarnizione", ["avocado"], 20, 60, 30, false), acid, salt, spice,
    ],
    ratios: [
      { numerator: "ripieno", denominator: "piadina", min: 0.8, max: 1.8 },
      { numerator: "verdure", denominator: "piadina", min: 0.4, max: 1.4 },
    ],
  },
  {
    id: "microwave-porridge", title: "Porridge caldo con frutta",
    description: "Fiocchi fini cotti al microonde con latte o bevanda di soia, pronti senza attese notturne.",
    family: "bowl", cuisine: "casalinga", technique: "idratazione al microonde",
    taste: "sweet", meals: sweetMeals, equipment: ["microwave"], minutes: 10,
    extraServingMinutes: 5, difficulty: "easy", mealPrep: true,
    slots: [
      slot("cereale", ["oats"], 25, 80, 45),
      slot("liquido", ["milk", "soy-milk"], 100, 300, 180),
      slot("frutta", fruit, 50, 180, 100),
      slot("salsa", dairy, 30, 150, 60, false), nuts, whey, sweetSpice, honey,
    ],
    ratios: [
      { numerator: "liquido", denominator: "cereale", min: 3, max: 5 },
      { numerator: "proteine in polvere", denominator: "liquido", min: 0, max: 0.1 },
    ],
  },
  {
    id: "creamy-tomato-pasta", title: "Pasta cremosa al pomodoro e formaggio spalmabile",
    description: "Pomodori ammorbiditi e formaggio spalmabile mantecato fuori dal fuoco: una salsa cremosa senza aggiungere panna.",
    family: "pasta", cuisine: "italiana", technique: "pasta risottata e mantecatura fuori dal fuoco",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove"],
    minutes: 25, extraServingMinutes: 3, difficulty: "easy", mealPrep: true,
    slots: [
      slot("pasta", ["pasta"], 40, 150, 90),
      slot("formaggio", ["cream-cheese"], 20, 100, 40),
      slot("verdure", ["tomato"], 40, 350, 150), oil, salt, spice,
    ],
    ratios: [
      { numerator: "formaggio", denominator: "pasta", min: 0.15, max: 1.5 },
      { numerator: "verdure", denominator: "pasta", min: 0.25, max: 5 },
    ],
  },
  {
    id: "caprese-pasta", title: "Pasta tiepida alla caprese",
    description: "Pomodoro fresco e mozzarella aggiunti fuori dal fuoco alla pasta cotta per assorbimento.",
    family: "pasta", cuisine: "italiana", technique: "pasta e condimento fresco",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove"],
    minutes: 22, extraServingMinutes: 3, difficulty: "easy", mealPrep: true,
    slots: [
      slot("pasta", ["pasta"], 40, 100, 70),
      slot("formaggio", ["mozzarella-light"], 60, 150, 100),
      slot("verdure", ["tomato"], 80, 250, 150), oil, salt,
    ],
    ratios: [
      { numerator: "formaggio", denominator: "pasta", min: 0.8, max: 2 },
      { numerator: "verdure", denominator: "pasta", min: 1, max: 3 },
    ],
  },
  {
    id: "ready-pancake-breakfast", title: "Pancake pronti con confettura e arachidi",
    description: "Pancake classici già cotti, serviti con i soli accompagnamenti pesati; nessun impasto o numero di pezzi dedotto dai grammi.",
    family: "pancakes", cuisine: "casalinga", technique: "impiattamento di pancake già cotti",
    taste: "sweet", meals: sweetMeals, equipment: [], minutes: 7,
    extraServingMinutes: 1, difficulty: "easy", mealPrep: false,
    slots: [
      slot("pancake", ["ready-pancakes"], 20, 300, 100),
      slot("confettura", ["jam"], 5, 80, 30),
      slot("crema di arachidi", ["peanut-butter"], 5, 60, 30), coffee,
    ], ratios: [],
  },
  {
    id: "cereal-yogurt-bowl", title: "Yogurt con cereali e cioccolato",
    description: "Yogurt greco bianco 0% con il cereale effettivamente selezionato e fondente 70%; cacao solo se presente e pesato.",
    family: "bowl", cuisine: "casalinga", technique: "assemblaggio di yogurt e cereali pronti",
    taste: "sweet", meals: sweetMeals, equipment: [], minutes: 7,
    extraServingMinutes: 1, difficulty: "easy", mealPrep: false,
    slots: [
      slot("crema", ["greek-yogurt"], 80, 400, 200),
      slot("cereale", ["breakfast-cereal", "oats"], 5, 100, 40),
      slot("cioccolato", ["dark-chocolate"], 2, 60, 20),
      slot("cacao", ["cocoa"], 0.5, 20, 5, false), coffee,
    ], ratios: [{ numerator: "cacao", denominator: "crema", min: 0, max: 0.1 }],
  },
  {
    id: "ham-cheese-bread", title: "Pane con prosciutto cotto e formaggio",
    description: "Pane comune, prosciutto cotto e formaggio fuso già pronti; il peso della fetta è fornito dall'utente.",
    family: "wrap", cuisine: "casalinga", technique: "farcitura di pane pronto",
    taste: "savory", meals: ["breakfast", "snack", ...savoryMeals], equipment: [], minutes: 7,
    extraServingMinutes: 1, difficulty: "easy", mealPrep: false,
    slots: [
      slot("pane", ["bread"], 20, 180, 50),
      slot("ripieno", ["cooked-ham"], 10, 150, 50),
      slot("formaggio", ["cheese-slice"], 5, 80, 20), coffee,
    ], ratios: [],
  },
  {
    id: "whey-drink", title: "Bevanda di whey in acqua",
    description: "Whey ricostituite in acqua misurata, non un dessert; frutta e caffè, se presenti, sono serviti separatamente.",
    family: "bowl", cuisine: "casalinga", technique: "ricostituzione di polvere in acqua",
    taste: "sweet", meals: ["breakfast", "snack"], equipment: [], minutes: 6,
    extraServingMinutes: 1, difficulty: "easy", mealPrep: false,
    slots: [
      slot("polvere", ["whey"], 5, 80, 20),
      slot("frutta", fruit, 10, 500, 150, false),
      slot("acqua", ["water"], 40, 1200, 200, false), coffee,
    ], ratios: [],
  },
  {
    id: "fruit-protein-snack", title: "Frutta e barretta proteica",
    description: "Spuntino composto da frutta fresca e barretta pronta: nessuna cottura e nessuna promessa nutrizionale automatica.",
    family: "bowl", cuisine: "casalinga", technique: "impiattamento di frutta e snack pronto",
    taste: "sweet", meals: ["breakfast", "snack"], equipment: [], minutes: 6,
    extraServingMinutes: 1, difficulty: "easy", mealPrep: false,
    slots: [
      slot("frutta", fruit, 10, 500, 150),
      slot("snack", ["protein-bar"], 10, 150, 50), coffee,
    ], ratios: [],
  },
  {
    id: "egg-lettuce-wrap", title: "Piadina classica con uova e lattuga",
    description: "Piadina non integrale con uova cotte in padella e lattuga fresca; nessun peso dedotto dal numero di uova.",
    family: "wrap", cuisine: "casalinga", technique: "cottura delle uova e farcitura di piadina",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove"],
    minutes: 20, extraServingMinutes: 6, difficulty: "easy", mealPrep: false,
    slots: [
      slot("piadina", ["plain-wrap"], 30, 180, 100),
      slot("uova", ["eggs"], 30, 250, 100),
      slot("verdure", ["lettuce"], 10, 350, 100), oil, salt, spice,
    ], ratios: [],
  },
  {
    id: "brown-rice-salmon", title: "Riso integrale con zucchine e salmone affumicato",
    description: "Riso integrale pesato secco e lessato per 35-45 minuti; salmone affumicato pronto aggiunto fuori dal fuoco.",
    family: "bowl", cuisine: "mediterranea", technique: "lessatura lunga di riso integrale",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove"],
    minutes: 55, extraServingMinutes: 4, difficulty: "easy", mealPrep: false,
    slots: [
      slot("cereale", ["brown-rice"], 30, 160, 90),
      slot("proteina", ["smoked-salmon"], 30, 250, 100),
      slot("verdure", ["zucchini"], 20, 450, 200), oil, acid, salt, spice,
    ], ratios: [],
  },
  {
    id: "white-fish-bread-salad", title: "Merluzzo con pane e lattuga",
    description: "Filetto di merluzzo crudo cotto dolcemente in padella, con pane e lattuga serviti a lato.",
    family: "salad", cuisine: "mediterranea", technique: "cottura coperta del pesce e contorno crudo",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove"],
    minutes: 24, extraServingMinutes: 6, difficulty: "easy", mealPrep: true,
    slots: [
      slot("proteina", ["white-fish"], 60, 450, 250),
      slot("verdure", ["lettuce"], 10, 400, 100), breadSide, oil, acid, salt, spice,
    ], ratios: [],
  },
  {
    id: "seafood-bread-salad", title: "Insalata di mare con pane e lattuga",
    description: "Mix di mare già cotto e sgocciolato al naturale; non pesce crudo e non una versione già condita con olio.",
    family: "salad", cuisine: "mediterranea", technique: "assemblaggio di mare cotto e verdura fresca",
    taste: "savory", meals: savoryMeals, equipment: [], minutes: 9,
    extraServingMinutes: 2, difficulty: "easy", mealPrep: false,
    slots: [
      slot("proteina", ["seafood-salad"], 60, 500, 350),
      slot("verdure", ["lettuce"], 10, 400, 100), breadSide, oil, acid, salt, spice,
    ], ratios: [],
  },
  {
    id: "cod-lettuce-boats", title: "Barchette di lattuga con merluzzo e crumble",
    description: "Merluzzo cotto e sfaldato nelle foglie crude di lattuga; tutto il pane pesato viene tostato in un crumble da aggiungere solo alla fine, non usato come falsa panatura.",
    family: "wrap", cuisine: "mediterranea", technique: "cottura del merluzzo e farcitura di foglie crude con crumble",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove", "thermometer"],
    minutes: 29, extraServingMinutes: 5, difficulty: "easy", mealPrep: true,
    slots: [
      slot("proteina", ["white-fish"], 60, 450, 185),
      slot("verdure", ["lettuce"], 20, 400, 125),
      slot("pane", ["bread"], 20, 180, 64), ...fishChefExtras,
    ], ratios: [],
  },
  {
    id: "cod-toasted-tartines", title: "Tartine di merluzzo e lattuga appassita",
    description: "Il pane tostato sostiene una farcitura calda di merluzzo sfaldato e lattuga appassita nel fondo già cotto del pesce; l'eventuale crema lega il ripieno fuori dal fuoco.",
    family: "wrap", cuisine: "mediterranea", technique: "tostatura del pane e farcitura calda con lattuga appassita",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove", "thermometer"],
    minutes: 30, extraServingMinutes: 5, difficulty: "easy", mealPrep: true,
    slots: [
      slot("proteina", ["white-fish"], 60, 450, 185),
      slot("verdure", ["lettuce"], 20, 400, 125),
      slot("pane", ["bread"], 20, 180, 64), ...fishChefExtras,
    ], ratios: [],
  },
  {
    id: "seafood-panzanella", title: "Panzanella di mare e lattuga",
    description: "Insalata di pane reidratato con acqua misurata, lattuga e mix di mare già cotto e sgocciolato: una panzanella senza ingredienti sottintesi, non pesce da cuocere.",
    family: "salad", cuisine: "mediterranea", technique: "reidratazione del pane e assemblaggio freddo di mare cotto",
    taste: "savory", meals: savoryMeals, equipment: [],
    minutes: 12, extraServingMinutes: 2, difficulty: "easy", mealPrep: false,
    slots: [
      slot("proteina", ["seafood-salad"], 60, 500, 230),
      slot("verdure", ["lettuce"], 20, 400, 125),
      slot("pane", ["bread"], 20, 180, 64), ...fishChefExtras,
    ], ratios: [],
  },
  {
    id: "seafood-lettuce-cups", title: "Coppe di lattuga con mare e pane tostato",
    description: "Foglie crude farcite con mix di mare già cotto, pane tostato e un eventuale condimento misurato; una parte del pane entra nel ripieno e il resto completa le coppe al momento di servire.",
    family: "wrap", cuisine: "mediterranea", technique: "tostatura del pane e farcitura fredda di coppe di lattuga",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove"],
    minutes: 15, extraServingMinutes: 2, difficulty: "easy", mealPrep: false,
    slots: [
      slot("proteina", ["seafood-salad"], 60, 500, 230),
      slot("verdure", ["lettuce"], 20, 400, 125),
      slot("pane", ["bread"], 20, 180, 64), ...fishChefExtras,
    ], ratios: [],
  },
  {
    id: "poultry-fennel-plate", title: "Bocconcini con finocchi e pane",
    description: "Pollo o tacchino cotto in padella con finocchi crudi a lato, senza sostituire la carne selezionata.",
    family: "salad", cuisine: "mediterranea", technique: "cottura di bocconcini e contorno di finocchi",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove"],
    minutes: 25, extraServingMinutes: 6, difficulty: "easy", mealPrep: true,
    slots: [
      slot("proteina", ["chicken", "turkey"], 60, 350, 200),
      slot("verdure", ["fennel"], 10, 450, 200), breadSide, oil, acid, salt, spice,
    ], ratios: [],
  },
  {
    id: "poultry-fennel-crunch", title: "Pollo al crumble di pane con slaw di finocchi",
    description: "Il pane previsto diventa crumble e crostini tostati; i finocchi affettati sottilissimi formano una slaw. Il condimento cremoso viene preparato solo con gli extra confermati.",
    family: "salad", cuisine: "mediterranea", technique: "tostatura separata del pane e slaw cruda",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove", "thermometer"],
    minutes: 30, extraServingMinutes: 5, difficulty: "easy", mealPrep: true,
    slots: [
      slot("proteina", ["chicken", "turkey"], 60, 350, 200),
      slot("verdure", ["fennel"], 40, 450, 200),
      slot("pane", ["bread"], 20, 180, 70),
      slot("crema", ["greek-yogurt"], 10, 100, 40, false),
      slot("acidità", ["lemon"], 3, 25, 15, false),
      slot("spezie", ["paprika"], 0.5, 2, 1, false), oil, salt,
    ], ratios: [{ numerator: "acidità", denominator: "verdure", min: 0, max: 0.25 }],
  },
  {
    id: "poultry-fennel-tartines", title: "Tartine calde di pollo e finocchi brasati",
    description: "Pane tostato come base di tartine aperte, con finocchi prima dorati e poi brasati e carne sfilacciata nel loro fondo; l'eventuale crema lega la farcitura fuori dal fuoco.",
    family: "wrap", cuisine: "mediterranea", technique: "brasatura dei finocchi e farcitura di tartine tostate",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove", "thermometer"],
    minutes: 32, extraServingMinutes: 3, difficulty: "easy", mealPrep: true,
    slots: [
      slot("proteina", ["chicken", "turkey"], 60, 350, 200),
      slot("verdure", ["fennel"], 40, 450, 200),
      slot("pane", ["bread"], 20, 180, 70),
      slot("crema", ["greek-yogurt"], 10, 100, 40, false),
      slot("acidità", ["lemon"], 3, 25, 15, false),
      slot("spezie", ["paprika"], 0.5, 2, 1, false), oil, salt,
    ], ratios: [{ numerator: "acidità", denominator: "verdure", min: 0, max: 0.25 }],
  },
  {
    id: "tomato-cheese-bread", title: "Pomodori, formaggio e pane",
    description: "Piatto freddo con un solo formaggio selezionato: mozzarella classica, caciotta oppure fiocchi di latte.",
    family: "salad", cuisine: "mediterranea", technique: "assemblaggio di formaggio e pomodoro fresco",
    taste: "savory", meals: savoryMeals, equipment: [], minutes: 9,
    extraServingMinutes: 2, difficulty: "easy", mealPrep: true,
    slots: [
      slot("formaggio", ["mozzarella", "caciotta", "cottage-cheese"], 30, 350, 150),
      slot("verdure", ["tomato"], 10, 450, 200),
      slot("pane", ["bread"], 10, 180, 70), oil, acid, salt, spice,
    ], ratios: [],
  },
  {
    id: "beef-zucchini-patties", title: "Medaglioni di manzo con zucchine",
    description: "Il macinato magro si compatta da solo: zucchine cotte a lato, pane facoltativo e nessun uovo o legante nascosto.",
    family: "patties", cuisine: "casalinga", technique: "compattazione di macinato e cottura in padella",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove"],
    minutes: 28, extraServingMinutes: 6, difficulty: "easy", mealPrep: true,
    slots: [
      slot("carne", ["lean-beef"], 60, 350, 200),
      slot("verdure", ["zucchini"], 20, 450, 200),
      slot("pangrattato", ["breadcrumbs"], 5, 15, 10, false),
      slot("farina", ["wheat-flour"], 5, 10, 5, false), breadSide, oil, acid, salt, spice,
    ], ratios: [],
  },
  {
    id: "tomato-parmesan-pasta", title: "Pasta al pomodoro e Parmigiano",
    description: "Pasta cotta nel fondo di pomodoro e mantecata fuori dal fuoco con tutto il Parmigiano pesato.",
    family: "pasta", cuisine: "italiana", technique: "pasta risottata e mantecatura con formaggio stagionato",
    taste: "savory", meals: savoryMeals, equipment: ["pan", "stove"],
    minutes: 25, extraServingMinutes: 3, difficulty: "easy", mealPrep: true,
    slots: [
      slot("pasta", ["pasta"], 30, 160, 90),
      slot("formaggio", ["parmesan"], 5, 80, 40),
      slot("verdure", ["tomato"], 20, 450, 150), oil, salt, spice,
    ], ratios: [],
  },
];
