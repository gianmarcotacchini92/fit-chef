import type { RecipeItem } from "./types";
import type { Template } from "./templates";

const SHORT_NAMES: Record<string, string> = {
  chicken: "pollo", turkey: "tacchino", tuna: "tonno", tofu: "tofu",
  chickpeas: "ceci", lentils: "lenticchie", rice: "riso", quinoa: "quinoa",
  oats: "avena", banana: "banana", strawberries: "fragole", berries: "frutti di bosco",
  apple: "mela", "greek-yogurt": "yogurt greco", skyr: "skyr",
  "mozzarella-light": "mozzarella light", "cottage-cheese": "fiocchi di latte",
  potato: "patate", "sweet-potato": "patate dolci", "peanut-butter": "burro di arachidi",
  almonds: "mandorle", walnuts: "noci", sesame: "sesamo", avocado: "avocado",
  "lean-beef": "manzo macinato magro", "white-fish": "merluzzo",
  mozzarella: "mozzarella classica", caciotta: "caciotta", parmesan: "Parmigiano",
  "protein-bar": "barretta proteica generica", fennel: "finocchi", lettuce: "lattuga",
};

export function buildTitle(template: Template, ingredients: RecipeItem[]): string {
  const has = (id: string) => ingredients.some((item) => item.ingredientId === id);
  const names = (role: string) => ingredients.filter((item) => item.role === role)
    .map((item) => SHORT_NAMES[item.ingredientId] ?? item.name.toLocaleLowerCase("it-IT")).join(" e ");
  const upperFirst = (value: string) => value.charAt(0).toLocaleUpperCase("it-IT") + value.slice(1);
  const seasoning = has("paprika") ? " alla paprika" : has("lemon") ? " al limone" : "";
  const topping = names("guarnizione");
  const sauce = names("salsa");
  switch (template.id) {
    case "one-pan-rice":
      return `${upperFirst(names("cereale"))}${seasoning || " in padella"} con ${names("proteina")} e ${names("verdure")}`;
    case "poached-rice-salad":
      return `Insalata tiepida di ${names("cereale")} e ${names("proteina")}, crema di ${sauce}${has("lemon") ? " al limone" : ""}`;
    case "oat-egg-crepe":
      return `Crêpe d'avena ripiene di ${names("ripieno")} e ${names("verdure")}`;
    case "banana-oat-pancakes":
      return `Mini pancake banana e avena${has("cinnamon") ? " alla cannella" : ""}${sauce ? ` con ${sauce}` : ""}`;
    case "yogurt-fruit-parfait":
      return `Coppa a strati di ${names("crema")} e ${names("frutta")}${topping ? ` con ${topping}` : ""}`;
    case "cocoa-banana-cream":
      return `Crema al cacao, banana e ${names("crema")}${topping ? ` con ${topping}` : ""}`;
    case "vegetable-frittata":
      return `Frittata morbida di ${names("verdure")}${names("formaggio") ? ` con ${names("formaggio")}` : ""}`;
    case "legume-crunch-salad": {
      const crunchy = ["carrot", "cucumber", "bell-pepper"].some(has);
      return `Insalata ${crunchy ? "croccante" : "fresca"} di ${names("legumi")} e ${names("verdure")}${has("lemon") ? " al limone" : ""}`;
    }
    case "tuna-vegetable-pasta":
      return `Pasta risottata al tonno con ${names("verdure")}`;
    case "legume-oat-patties":
      return `Medaglioni di ${names("legumi")} e avena${has("paprika") ? " alla paprika" : ""}${sauce ? ` con crema di ${sauce}` : ""}`;
    case "potato-protein-skillet":
      return `Padellata di ${names("tubero")}${seasoning} con ${names("proteina")} e ${names("verdure")}`;
    case "ready-wrap":
      return `Piadina integrale ripiena di ${names("ripieno")} e ${names("verdure")}${has("avocado") ? " con avocado" : ""}`;
    case "microwave-porridge":
      return `Porridge caldo d'avena${has("cinnamon") ? " alla cannella" : ""} con ${names("frutta")}${topping ? ` e ${topping}` : ""}`;
    case "caprese-pasta":
      return "Caprese tiepida di pasta, pomodoro e mozzarella light";
    case "creamy-tomato-pasta":
      return `Pasta vellutata al pomodoro e formaggio spalmabile${has("paprika") ? " alla paprika" : ""}`;
    case "ready-pancake-breakfast":
      return "Pancake classici pronti con confettura e burro di arachidi 100%";
    case "cereal-yogurt-bowl":
      return `Ciotola di yogurt greco 0%, ${has("oats") ? "fiocchi di avena" : "cornflakes"} e fondente 70%${has("cocoa") ? " al cacao" : ""}`;
    case "ham-cheese-bread":
      return "Pane farcito con prosciutto cotto e formaggio fuso a fette";
    case "whey-drink":
      return `Whey in acqua${names("frutta") ? ` con ${names("frutta")} a lato` : ""}${has("coffee") ? " e caffè separato" : ""}`;
    case "fruit-protein-snack":
      return `${upperFirst(names("frutta"))} e ${names("snack")}: spuntino pronto`;
    case "egg-lettuce-wrap":
      return "Piadina classica con uova strapazzate e lattuga a lato";
    case "brown-rice-salmon":
      return "Riso integrale lessato con zucchine e salmone affumicato";
    case "white-fish-bread-salad":
      return `Merluzzo cotto in padella${seasoning}, lattuga${has("bread") ? " e pane" : ""}`;
    case "seafood-bread-salad":
      return `Piatto di mare già cotto con lattuga${has("bread") ? " e pane" : ""}`;
    case "cod-lettuce-boats":
      return `Barchette di lattuga con merluzzo e crumble di pane tostato${has("greek-yogurt") ? ", crema di yogurt" : ""}`;
    case "cod-toasted-tartines":
      return `Tartine tostate di merluzzo e lattuga appassita${has("paprika") ? " alla paprika" : ""}`;
    case "seafood-panzanella":
      return `Panzanella di pane reidratato, mare già cotto e lattuga${has("lemon") ? " al limone" : ""}`;
    case "seafood-lettuce-cups":
      return `Coppe di lattuga con mare già cotto e pane in due consistenze${has("greek-yogurt") ? " allo yogurt" : ""}`;
    case "poultry-fennel-plate":
      return `Bocconcini di ${names("proteina")}${seasoning} con finocchi crudi${has("bread") ? " e pane" : ""}`;
    case "poultry-fennel-crunch":
      return `${upperFirst(names("proteina"))} al crumble tostato${has("paprika") ? " alla paprika" : ""}, slaw di finocchi${has("greek-yogurt") ? " allo yogurt" : ""}`;
    case "poultry-fennel-tartines":
      return `Tartine tostate di ${names("proteina")} sfilacciato e finocchi brasati${has("greek-yogurt") ? " in crema di yogurt" : ""}`;
    case "tomato-cheese-bread":
      return `Pomodori con ${names("formaggio")} e pane di frumento`;
    case "beef-zucchini-patties":
      return `Medaglioni di manzo macinato magro${has("wheat-flour") ? " infarinati" : has("breadcrumbs") ? " con pangrattato" : ""} e zucchine${has("bread") ? ", pane a lato" : ""}`;
    case "tomato-parmesan-pasta":
      return "Pasta risottata al pomodoro mantecata con Parmigiano";
    default:
      throw new Error(`Titolo editoriale mancante per l'archetipo ${template.id}.`);
  }
}
