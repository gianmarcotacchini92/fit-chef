import type { Ingredient, IngredientCategory, Nutrients } from "./types";

export const CATALOG_VERSION = "fit-chef-generic-2026-09-09-v3";

const SOURCE =
  "Stima editoriale generica, snapshot 08/09/2026, per 100 g nello stato indicato; non un record USDA né un'analisi del prodotto. Carboidrati disponibili, fibre separate. Verificare etichetta e allergeni della confezione.";

function food(
  id: string, name: string, aliases: string[], emoji: string,
  category: IngredientCategory, state: string,
  values: [number, number, number, number, number],
  defaultGrams: number, allergens: string[] = [], vegetarian = true,
  addedSugar: number | null = 0,
): Ingredient {
  const [kcal, protein, carbs, fat, fiber] = values;
  const nutrients: Nutrients = { kcal, protein, carbs, fat, fiber };
  return {
    id, name, aliases, emoji, category, state, nutrients, allergens,
    vegetarian, addedSugar, defaultGrams, source: SOURCE,
  };
}

// Generic food estimates, not branded foods or attributed database records.
// "Carbs" excludes fibre throughout; kcal is an independent food estimate.
export const INGREDIENTS: Ingredient[] = [
  food("chicken", "Petto di pollo", ["pollo", "petto pollo", "chicken"], "🍗", "protein", "crudo, senza pelle e ossa", [110, 23.1, 0, 1.2, 0], 200, [], false),
  food("turkey", "Petto di tacchino", ["tacchino", "turkey"], "🍗", "protein", "crudo, senza pelle e ossa", [107, 24, 0, 1.2, 0], 200, [], false),
  food("tuna", "Tonno al naturale", ["tonno", "tuna"], "🐟", "protein", "in scatola, sgocciolato, pronto al consumo", [116, 25.5, 0, 1, 0], 160, ["fish"], false),
  food("eggs", "Uova", ["uovo", "eggs"], "🥚", "protein", "crude, peso edibile senza guscio", [143, 12.6, 0.7, 9.5, 0], 100, ["eggs"]),
  food("egg-whites", "Albume", ["albumi", "egg whites"], "🥚", "protein", "pastorizzato liquido, da cuocere", [46, 10.2, 0.7, 0.2, 0], 150, ["eggs"]),
  food("tofu", "Tofu al naturale", ["tofu"], "🧊", "protein", "compatto, sgocciolato, pastorizzato e pronto al consumo secondo etichetta", [125, 13, 1, 7, 1], 180, ["soy"]),
  food("chickpeas", "Ceci cotti", ["ceci", "chickpeas"], "🫘", "protein", "cotti senza condimento, sgocciolati", [139, 7.2, 18.1, 2.3, 6.3], 200),
  food("lentils", "Lenticchie cotte", ["lenticchie", "lentils"], "🫘", "protein", "cotte senza condimento, sgocciolate", [105, 8.2, 12.5, 0.5, 7], 200),
  food("rice", "Riso", ["riso bianco", "rice"], "🍚", "carb", "secco, chicco bianco a cottura 15-18 minuti", [356, 7, 79, 0.7, 1], 100),
  food("quinoa", "Quinoa", ["quinoa bianca"], "🌾", "carb", "secca, da sciacquare e cuocere", [368, 14.1, 57.2, 6.1, 7], 80),
  food("oats", "Fiocchi di avena", ["avena", "fiocchi avena", "oats"], "🌾", "carb", "secchi, fini; non certificati senza glutine", [375, 13, 59, 7, 10], 80, ["gluten"]),
  food("pasta", "Pasta di semola", ["pasta", "pasta secca"], "🍝", "carb", "secca, senza uova, cottura 10-12 minuti", [353, 12.5, 70.5, 1.5, 3], 100, ["gluten"]),
  food("whole-wheat-wrap", "Piadina integrale", ["wrap integrale", "tortilla integrale"], "🫓", "carb", "confezionata, pronta, ricetta vegetale senza strutto; controllare etichetta", [300, 9, 47, 7, 6], 70, ["gluten"], true, null),
  food("potato", "Patate", ["patata", "potato"], "🥔", "carb", "crude, pelate, peso edibile", [77, 2, 15.4, 0.1, 2.2], 300),
  food("sweet-potato", "Patate dolci", ["patata dolce", "batata", "sweet potato"], "🍠", "carb", "crude, pelate, peso edibile", [86, 1.6, 17.1, 0.1, 3], 250),
  food("zucchini", "Zucchine", ["zucchina", "zucchini"], "🥒", "vegetable", "crude, mondate", [17, 1.2, 2.1, 0.3, 1.1], 250),
  food("broccoli", "Broccoli", ["broccolo"], "🥦", "vegetable", "crudi, cimette mondate", [34, 2.8, 4, 0.4, 2.6], 250),
  food("spinach", "Spinaci", ["spinacio", "spinach"], "🥬", "vegetable", "crudi, lavati e mondati", [23, 2.9, 1.4, 0.4, 2.2], 150),
  food("tomato", "Pomodori", ["pomodoro", "pomodorini", "tomato"], "🍅", "vegetable", "crudi, peso edibile", [18, 0.9, 2.7, 0.2, 1.2], 200),
  food("cucumber", "Cetrioli", ["cetriolo", "cucumber"], "🥒", "vegetable", "crudi, peso edibile", [15, 0.7, 2.1, 0.1, 0.5], 200),
  food("carrot", "Carote", ["carota", "carrot"], "🥕", "vegetable", "crude, mondate", [41, 0.9, 6.8, 0.2, 2.8], 150),
  food("bell-pepper", "Peperoni", ["peperone", "bell pepper"], "🫑", "vegetable", "crudi, senza semi", [26, 1, 4.2, 0.3, 2], 200),
  food("peas", "Piselli", ["piselli surgelati", "peas"], "🟢", "vegetable", "surgelati, da cuocere", [77, 5.2, 9, 0.4, 5.2], 150),
  food("banana", "Banana", ["banane"], "🍌", "fruit", "cruda, senza buccia", [89, 1.1, 20.2, 0.3, 2.6], 120),
  food("strawberries", "Fragole", ["fragola", "strawberries"], "🍓", "fruit", "fresche, mondate", [32, 0.7, 5.5, 0.3, 2], 200),
  food("berries", "Frutti di bosco", ["frutti rossi", "berries"], "🫐", "fruit", "freschi, misti, lavati; non surgelati", [45, 0.9, 7, 0.4, 4], 150),
  food("apple", "Mela", ["mele", "apple"], "🍎", "fruit", "cruda, con buccia senza torsolo", [52, 0.3, 11.4, 0.2, 2.4], 180),
  food("greek-yogurt", "Yogurt greco 0%", ["yogurt greco", "yogurt", "greek yogurt"], "🥣", "dairy", "bianco naturale, senza zuccheri aggiunti, refrigerato", [59, 10.3, 3.6, 0.4, 0], 170, ["milk"]),
  food("skyr", "Skyr naturale", ["skyr"], "🥣", "dairy", "bianco naturale, senza zuccheri aggiunti, refrigerato", [63, 11, 4, 0.2, 0], 170, ["milk"]),
  food("mozzarella-light", "Mozzarella light", ["mozzarella leggera"], "🧀", "dairy", "sgocciolata, con caglio microbico per versione vegetariana", [165, 20, 1, 9, 0], 125, ["milk"]),
  food("cottage-cheese", "Fiocchi di latte", ["cottage cheese", "fiocchi latte"], "🧀", "dairy", "naturali, con caglio microbico, refrigerati", [98, 12, 3, 4.3, 0], 150, ["milk"]),
  {
    ...food("cream-cheese", "Formaggio spalmabile classico", ["formaggio spalmabile", "spalmabile", "philadelphia", "philadelphia classico", "philadelphia original"], "🧀", "dairy",
      "classico, refrigerato; stima generica, non light; verificare l'etichetta", [240, 5.5, 4.5, 22, 0], 80, ["milk"], true, null),
    source: "Stima editoriale generica 09/09/2026 per 100 g di formaggio spalmabile classico, non dati ufficiali Philadelphia. Carboidrati disponibili, fibre separate; verificare variante, ingredienti, allergeni e valori sull'etichetta.",
  },
  food("milk", "Latte parzialmente scremato", ["latte", "milk"], "🥛", "dairy", "pastorizzato, 1,5% grassi", [46, 3.4, 4.9, 1.5, 0], 250, ["milk"]),
  food("soy-milk", "Bevanda di soia", ["latte di soia", "soy milk"], "🥛", "dairy", "naturale, senza zuccheri aggiunti", [33, 3.3, 0.5, 1.8, 0.6], 250, ["soy"]),
  food("whey", "Proteine whey neutre", ["whey", "proteine in polvere"], "🥄", "protein", "polvere neutra; composizione e zuccheri aggiunti dipendono dalla marca", [380, 78, 7, 5, 0], 30, ["milk"], true, null),
  food("olive-oil", "Olio extravergine di oliva", ["olio", "olio evo", "olio oliva", "olive oil"], "🫒", "fat", "tal quale, da pesare", [900, 0, 0, 100, 0], 10),
  food("peanut-butter", "Burro di arachidi 100%", ["burro arachidi", "peanut butter", "crema arachidi", "crema di arachidi"], "🥜", "fat", "sole arachidi, senza zuccheri né olio aggiunti", [610, 26, 12, 50, 8], 25, ["peanuts"]),
  food("almonds", "Mandorle", ["mandorla", "almonds"], "🌰", "fat", "sgusciate, al naturale", [610, 21, 7, 54, 11], 25, ["nuts"]),
  food("walnuts", "Noci", ["noce", "walnuts"], "🌰", "fat", "gherigli al naturale", [680, 15, 7, 65, 6.7], 25, ["nuts"]),
  food("sesame", "Semi di sesamo", ["sesamo", "sesame"], "🌱", "fat", "secchi", [573, 17.7, 11.6, 49.7, 11.8], 15, ["sesame"]),
  food("avocado", "Avocado", ["avocado maturo"], "🥑", "fruit", "crudo, sola polpa", [160, 2, 1.8, 14.7, 6.7], 100),
  food("lemon", "Succo di limone", ["limone", "succo limone", "lemon"], "🍋", "pantry", "succo spremuto, senza buccia né semi", [22, 0.4, 2.5, 0.2, 0.3], 30),
  food("paprika", "Paprika", ["paprica"], "🌶️", "pantry", "polvere pura", [282, 14.1, 19.1, 12.9, 34.9], 3),
  food("salt", "Sale", ["sale fino", "salt"], "🧂", "pantry", "secco", [0, 0, 0, 0, 0], 2),
  food("cocoa", "Cacao amaro", ["cacao", "cocoa"], "🍫", "pantry", "polvere non zuccherata", [350, 22, 12, 21, 30], 15),
  food("cinnamon", "Cannella", ["cinnamon"], "🪵", "pantry", "polvere pura", [247, 4, 27.5, 1.2, 53], 2),
  food("honey", "Miele", ["honey"], "🍯", "pantry", "tal quale; usato nella ricetta come zucchero aggiunto", [304, 0.3, 82.4, 0, 0], 15, [], true, 82.4),
  food("water", "Acqua", ["water"], "💧", "pantry", "potabile", [0, 0, 0, 0, 0], 250),
  food("lean-beef", "Macinato magro di manzo", ["manzo macinato magro", "carne macinata magra", "macinato di manzo", "lean ground beef"], "🥩", "protein", "crudo, macinato magro circa 5% grassi; non un taglio intero", [137, 21, 0, 5.5, 0], 200, [], false),
  food("breadcrumbs", "Pangrattato", ["pane grattugiato", "breadcrumbs"], "🍞", "carb", "secco, di pane di frumento; controllare etichetta", [351, 12, 68, 3, 4], 15, ["gluten"], true, null),
  food("wheat-flour", "Farina di frumento", ["farina", "farina 00", "wheat flour"], "🌾", "carb", "secca, tipo 00, da cuocere", [343, 11, 71, 1, 3], 10, ["gluten"]),
  food("bread", "Pane di frumento", ["pane", "pane bianco", "wheat bread"], "🍞", "carb", "pronto al consumo, pane comune non integrale; peso senza confezione", [265, 8.5, 49, 3.2, 3.5], 70, ["gluten"], true, null),
  food("brown-rice", "Riso integrale", ["riso integrale secco", "brown rice"], "🍚", "carb", "secco, integrale, cottura 35-45 minuti; non riso bianco né già cotto", [365, 7.5, 74, 2.7, 3.5], 90),
  food("smoked-salmon", "Salmone affumicato", ["salmone affumicato pronto", "smoked salmon"], "🐟", "protein", "refrigerato, pronto al consumo secondo etichetta; non salmone fresco crudo", [180, 22, 0, 10, 0], 100, ["fish"], false, null),
  food("white-fish", "Merluzzo", ["merluzzo crudo", "cod"], "🐟", "protein", "crudo, filetto senza pelle e lische, scongelato se necessario prima della preparazione", [82, 18, 0, 0.7, 0], 250, ["fish"], false),
  {
    ...food("seafood-salad", "Insalata di mare al naturale", ["insalata di mare", "seafood salad"], "🦐", "protein",
      "mix generico di pesce, crostacei e molluschi già cotti e sgocciolati, pronto al consumo, senza condimento; possibili solfiti", [95, 17, 2, 2, 0], 350, ["fish", "crustaceans", "molluscs", "sulphites"], false, null),
    source: "Stima editoriale generica 09/09/2026 per 100 g di mix di mare cotto e sgocciolato senza condimento. Non dati ufficiali di un prodotto: composizione, nutrienti, solfiti e allergeni dipendono dalla confezione. Non equivalente a una versione con olio o salsa.",
  },
  food("fennel", "Finocchi", ["finocchio", "fennel"], "🥬", "vegetable", "crudi, mondati, peso edibile", [31, 1.2, 4.9, 0.2, 3.1], 200),
  food("lettuce", "Lattuga", ["insalata verde", "lettuce"], "🥬", "vegetable", "cruda, lavata e mondata, peso edibile", [15, 1.4, 1.3, 0.2, 1.3], 100),
  food("mozzarella", "Mozzarella classica", ["mozzarella", "mozzarella normale"], "🧀", "dairy", "regolare, non light, sgocciolata; versione con caglio microbico da verificare in etichetta", [250, 18, 1, 19, 0], 200, ["milk"]),
  food("caciotta", "Caciotta", ["caciotta fresca"], "🧀", "dairy", "formaggio intero generico, peso edibile senza crosta; caglio animale assunto, non vegetariano", [360, 24, 1, 29, 0], 150, ["milk"], false),
  food("parmesan", "Parmigiano", ["parmigiano reggiano", "parmesan"], "🧀", "dairy", "stagionato, peso edibile senza crosta, da grattugiare; caglio animale, non vegetariano", [402, 32, 0, 30, 0], 40, ["milk"], false),
  food("cooked-ham", "Prosciutto cotto", ["cotto", "cooked ham"], "🥓", "protein", "affettato pronto al consumo; stima generica, controllare allergeni e ingredienti della confezione", [145, 20, 1.5, 6.5, 0], 50, ["milk"], false, null),
  food("cheese-slice", "Formaggio fuso a fette", ["sottiletta", "sottilette", "fetta di formaggio fuso", "cheese slice"], "🧀", "dairy", "fetta standard generica già pronta, peso effettivo senza involucro; caglio animale assunto", [280, 15, 6, 22, 0], 20, ["milk"], false, null),
  food("jam", "Confettura di frutta zuccherata", ["marmellata", "confettura", "jam"], "🍓", "pantry", "generica con zucchero, pronta; non senza zuccheri aggiunti", [250, 0.3, 60, 0.1, 1], 30, [], true, 45),
  food("breakfast-cereal", "Cornflakes generici", ["cornflakes", "fiocchi di mais", "corn flakes"], "🌽", "carb", "pronti al consumo, zuccherati, con possibile malto d'orzo; non equivalenti a tutti i cereali da colazione", [370, 7, 82, 1, 3], 40, ["gluten"], true, 7),
  food("dark-chocolate", "Cioccolato fondente 70%", ["cioccolato fondente", "fondente 70%", "dark chocolate"], "🍫", "fat", "generico al 70% cacao, pronto al consumo; controllare latte e lecitina di soia", [580, 8, 34, 43, 10], 20, ["milk", "soy"], true, 28),
  food("ready-pancakes", "Pancake classici pronti", ["pancake", "pancakes", "pancake pronti"], "🥞", "carb", "già cotti e pronti al consumo secondo etichetta; pesare il totale effettivo, non pancake proteici", [227, 6, 28, 10, 1], 100, ["gluten", "milk", "eggs"], true, null),
  {
    ...food("protein-bar", "Barretta proteica generica", ["barretta proteica", "protein bar"], "🍫", "protein",
      "pronta, peso netto senza involucro; composizione incerta, non rappresenta ogni snack proteico", [370, 30, 30, 13, 6], 50, ["milk", "soy", "gluten", "peanuts", "nuts", "eggs", "sesame"], false, null),
    source: "Stima editoriale generica 09/09/2026 per 100 g di barretta proteica, non valori ufficiali di alcuna marca. Nutrienti molto variabili; allergeni conservativi e stato vegetariano non garantito (possibile gelatina/collagene). Confermare prodotto, peso ed etichetta prima dell'uso.",
  },
  food("coffee", "Caffè nero pronto non zuccherato", ["caffe", "caffè", "caffe nero", "black coffee"], "☕", "pantry", "bevanda già preparata senza zucchero né latte; pesare il liquido, non la polvere", [1, 0.1, 0, 0, 0], 30),
  food("plain-wrap", "Piadina di frumento classica", ["piadina", "piadina classica", "piadina non integrale", "plain wrap", "wrap"], "🫓", "carb", "confezionata non integrale, cotta, ricetta vegetale senza strutto; controllare etichetta e istruzioni di riscaldamento", [320, 8, 50, 10, 2.5], 100, ["gluten"], true, null),
];

const byId = new Map(INGREDIENTS.map((ingredient) => [ingredient.id, ingredient]));

export function getIngredient(id: string): Ingredient | undefined {
  return byId.get(id);
}
