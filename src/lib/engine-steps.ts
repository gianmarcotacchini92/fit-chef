import type { RecipeItem, RecipeStep } from "./types";
import type { Template } from "./templates";

export function formatGrams(grams: number): string {
  return `${Number(grams.toFixed(3)).toLocaleString("it-IT", { maximumFractionDigits: 3 })} g`;
}

export function buildSteps(template: Template, items: RecipeItem[], servings: number): RecipeStep[] {
  const groups = (...roles: string[]) => items.filter((item) => roles.includes(item.role));
  const list = (...roles: string[]) => groups(...roles).map((item) => `${formatGrams(item.grams)} di ${item.name}`).join(", ");
  const amount = (...roles: string[]) => groups(...roles).reduce((sum, item) => sum + item.grams, 0);
  const water = (ml: number) => `${Math.ceil(ml)} ml di acqua potabile`;
  const oil = list("olio");
  const seasoning = list("sale", "spezie");
  const finish = list("salsa", "acidità");
  const garnishes = list("guarnizione", "aroma", "dolcificante");
  const rawPoultry = items.some((item) => ["chicken", "turkey"].includes(item.ingredientId));
  const rawBeef = items.some((item) => item.ingredientId === "lean-beef");
  const rawFish = items.some((item) => item.ingredientId === "white-fish");
  const safety = rawPoultry
    ? "Verifica almeno 74 °C al cuore di tutti i bocconcini con un termometro alimentare; il colore non prova la sicurezza. Prosegui la cottura se necessario."
    : "";
  const panStart = oil
    ? `Distribuisci nella padella antiaderente ${oil}: è tutto l'olio della ricetta e non va aggiunto di nuovo.`
    : "Usa una padella antiaderente integra senza grassi aggiunti.";
  const optionalSeasoning = seasoning ? `Incorpora ${seasoning}.` : "";
  const optionalFinish = finish
    ? `Mescola ${finish} e aggiungi questo condimento soltanto fuori dal fuoco.`
    : "";
  const optionalGarnish = garnishes ? `Completa con ${garnishes}.` : "";
  const drafts: Array<[string, string, number]> = [];
  const add = (title: string, instruction: string, minutes: number) => drafts.push([title, instruction.replace(/\s+/g, " ").trim(), minutes]);
  add(
    "Pesa e prepara",
    `Quantità TOTALI per ${servings} ${servings === 1 ? "porzione" : "porzioni"}: ${items.map((item) => `${formatGrams(item.grams)} di ${item.name} (${item.state})`).join("; ")}. Lava e taglia solo i vegetali presenti. ${rawPoultry || rawBeef || rawFish ? "Non lavare carne o pesce crudi; usa utensili separati dai cibi pronti e lava mani e superfici dopo averli manipolati." : ""} ${rawPoultry ? template.id === "poultry-fennel-tartines" ? "Taglia la carne in fettine spesse al massimo 1 cm, non a cubetti: dopo la cottura verrà sfilacciata." : "Taglia la carne in cubetti di circa 1,5 cm." : ""}`,
    4,
  );
  switch (template.id) {
    case "one-pan-rice":
      add("Avvia la cottura", `${panStart} A fuoco medio cuoci ${list("proteina")} per 4 minuti, girando. Aggiungi ${list("verdure")}, tagliate fini, e ${list("cereale")}; mescola per 2 minuti. ${items.some((item) => item.ingredientId === "quinoa") ? "Sciacqua il cereale prima di aggiungerlo." : ""} ${optionalSeasoning}`, 6);
      add("Cuoci per assorbimento", `Versa ${water(amount("cereale") * 2.5)} nella stessa padella, porta a leggero bollore e copri (circa 2 minuti). Cuoci 16-18 minuti, finché il cereale è tenero e i bocconcini sono cotti. ${safety} Se asciuga prima, aggiungi fino a ${water(50 * servings)} misurati, senza altro condimento.`, 20);
      add("Completa e porziona", `${optionalFinish} Distribuisci tutto in ${servings} porzioni uguali, compresi fondo di cottura e condimento.`, 2);
      break;
    case "poached-rice-salad": {
      const cookedVeg = groups("verdure").filter((item) => item.ingredientId === "zucchini");
      const freshVeg = groups("verdure").filter((item) => item.ingredientId !== "zucchini");
      const protein = rawPoultry ? `e ${list("proteina")}` : "";
      add("Lessa dolcemente", `In una padella profonda porta a bollore ${water(amount("cereale") * 8)} (circa 3 minuti). Aggiungi ${list("cereale")} ${protein}; cuoci a leggero bollore per 16-18 minuti. ${cookedVeg.length ? `Negli ultimi 5 minuti aggiungi ${cookedVeg.map((item) => `${formatGrams(item.grams)} di ${item.name}`).join(", ")} a dadini.` : ""} ${safety} Scola bene senza attendere un raffreddamento completo.`, 21);
      add("Condisci l'insalata tiepida", `Mescola ${list("salsa", "olio", "acidità", "sale", "spezie")}. Unisci al cereale ${rawPoultry ? "i bocconcini già cotti" : list("proteina")}${freshVeg.length ? ` e ${freshVeg.map((item) => `${formatGrams(item.grams)} di ${item.name}`).join(", ")} tagliati piccoli` : ""}. Aggiungi tutto il condimento una sola volta e dividi in ${servings} porzioni. Servi tiepido; non è prevista una fase di raffreddamento in frigorifero.`, 4);
      break;
    }
    case "oat-egg-crepe":
      add("Prepara una pastella vera", `Macina finemente ${list("farina")} nel mixer. Sbatti ${list("legante")}, incorpora la farina ottenuta e ${water(amount("farina") * 1.5)} fino a una pastella fluida senza grumi. ${optionalSeasoning} Lascia idratare 3 minuti.`, 6);
      add("Cuoci le crêpe", `${panStart} Versa la pastella in strati sottili, formando ${servings * 2} crêpe piccole. Cuoci circa 2 minuti sul primo lato e 1 sul secondo, a fuoco medio-basso, fino a centro completamente rappreso: verifica 71 °C con il termometro alimentare, senza parti liquide. ${oil ? "Ripartisci l'olio già misurato tra le crêpe, senza aggiungerne altro." : ""}`, 10);
      add("Farcisci e piega", `Suddividi ${list("ripieno", "verdure")} sulle crêpe. ${optionalFinish} Piega senza sovraccaricare e servi due crêpe per porzione.`, 3);
      break;
    case "banana-oat-pancakes":
      add("Frulla la pastella", `Macina ${list("farina")}, poi frulla con ${list("legante", "frutta")} fino a una pastella densa. Fai riposare 3 minuti; non occorrono altri ingredienti.`, 5);
      add("Cuoci pancake piccoli", `${panStart} Forma ${servings * 4} pancake di circa 8 cm, distribuendo l'impasto in parti uguali. Cuoci a fuoco medio-basso circa 3 minuti per lato, anche in più turni: devono essere rappresi al centro; verifica 71 °C con il termometro alimentare. ${oil ? "Usa solo l'olio già misurato." : ""}`, 9);
      add("Completa", `${optionalFinish} ${optionalGarnish} Dividi in ${servings} porzioni da quattro pancake ciascuna.`, 2);
      break;
    case "yogurt-fruit-parfait":
      add("Crea gli strati", `Lavora ${list("crema")}${amount("proteine in polvere") ? ` con ${list("proteine in polvere")}` : ""}. Taglia ${list("frutta")} e alternali in ${servings} coppette. ${amount("cereale") ? `Aggiungi ${list("cereale")} fini nella crema: resteranno leggermente consistenti, senza ammollo notturno.` : ""} ${optionalGarnish} Servi subito.`, 3);
      break;
    case "cocoa-banana-cream":
      add("Schiaccia e mescola", `Schiaccia ${list("frutta")} con una forchetta fino a renderla cremosa. Incorpora ${list("crema", "cacao", "proteine in polvere")}, mescolando fino a eliminare i grumi. ${optionalGarnish} Distribuisci in ${servings} coppette e servi subito: non serve montare né refrigerare per addensare.`, 2);
      break;
    case "vegetable-frittata":
      add("Cuoci le verdure", `${panStart} Cuoci ${list("verdure")} tagliate fini con ${water(30 * servings)} per 6 minuti. Lascia evaporare il liquido in eccesso. ${optionalSeasoning}`, 6);
      add("Fai rapprendere", `Sbatti ${list("uova", "albume")}${amount("formaggio") ? ` e incorpora ${list("formaggio")} sminuzzato` : ""}. Versa sulle verdure e cuoci coperto a fuoco basso per 10 minuti: il centro deve essere completamente rappreso; verifica 71 °C con il termometro alimentare. Se necessario prosegui la cottura.`, 10);
      add("Porziona", `Lascia assestare 2 minuti e dividi tutta la frittata in ${servings} porzioni uguali.`, 2);
      break;
    case "legume-crunch-salad":
      add("Assembla", `Risciacqua e scola ${list("legumi")}; il peso indicato è già quello cotto e sgocciolato. Unisci ${list("verdure")}, tagliate a piccoli pezzi${amount("aggiunta") ? `, e ${list("aggiunta")}` : ""}.`, 3);
      add("Condisci e servi", `${list("olio", "acidità", "salsa", "sale", "spezie") ? `Mescola ${list("olio", "acidità", "salsa", "sale", "spezie")} e versa tutto una sola volta sull'insalata.` : "Mescola delicatamente senza altri condimenti."} ${optionalGarnish} Distribuisci in ${servings} porzioni uguali.`, 3);
      break;
    case "tuna-vegetable-pasta":
      add("Avvia le verdure", `${panStart} Cuoci ${list("verdure")} tagliate fini per 3 minuti. ${optionalSeasoning}`, 3);
      add("Cuoci la pasta", `Aggiungi ${list("pasta")} secca e ${water(amount("pasta") * 3)}. Porta a bollore e cuoci 10-12 minuti mescolando, fino a pasta tenera. Se necessario aggiungi fino a ${water(50 * servings)} misurati; il fondo deve restare cremoso, non asciutto.`, 13);
      add("Unisci il tonno", `Incorpora ${list("proteina")}, già cotto e sgocciolato, per l'ultimo minuto. Spegni. ${optionalFinish} Dividi pasta, verdure e tutto il condimento in ${servings} porzioni uguali.`, 3);
      break;
    case "legume-oat-patties":
      add("Prepara l'impasto", `Macina ${list("farina")} nel mixer. Schiaccia con una forchetta ${list("legumi")} ben sgocciolati e mescola con la farina ottenuta e ${list("legante")}. ${amount("verdure") ? `Grattugia finemente ${list("verdure")} e incorpora senza aggiungere liquidi.` : ""} ${optionalSeasoning} Riposa 5 minuti per far assorbire l'umidità.`, 9);
      add("Forma e cuoci", `${panStart} Forma ${servings * 4} polpette piatte, spesse al massimo 1 cm. Cuoci a fuoco medio-basso 5 minuti per lato, finché compatte, senza interno liquido; verifica almeno 71 °C al cuore con il termometro alimentare. Non aggiungere altro olio.`, 11);
      add("Servi", `${optionalFinish} Distribuisci quattro polpette e una quota uguale dell'eventuale salsa per ciascuna delle ${servings} porzioni.`, 3);
      break;
    case "potato-protein-skillet":
      add("Precuoci i tuberi", `Taglia ${list("tubero")} a cubetti di circa 1 cm. Mettili nella padella con ${water(120 * servings)}, copri e cuoci 10 minuti a fuoco medio, poi lascia evaporare l'acqua residua.`, 11);
      add("Completa la padellata", `${panStart} Aggiungi ${list("proteina", "verdure")} tagliate piccole; cuoci 14-16 minuti, mescolando spesso, fino a tuberi teneri e bocconcini cotti. ${optionalSeasoning} ${safety}`, 16);
      add("Servi", `${optionalFinish} Dividi tutta la preparazione in ${servings} porzioni uguali.`, 2);
      break;
    case "ready-wrap":
      add("Prepara il ripieno", `Mescola ${list("ripieno", "verdure")} tagliati piccoli. ${optionalSeasoning} ${optionalFinish} ${optionalGarnish}`, 3);
      add("Farcisci", `Usa ${list("piadina")} già pronta al consumo secondo etichetta. Suddividi base e ripieno in ${servings} porzioni, distribuisci il ripieno al centro e ripiega i bordi. Servi a freddo; non occorrono altri grassi né riscaldamento.`, 2);
      break;
    case "microwave-porridge":
      add("Cuoci in una ciotola capiente", `Mescola ${list("cereale", "liquido")} in un recipiente adatto al microonde, capiente almeno quattro volte il volume. Per ogni porzione cuoci a 700 W per 2 minuti, mescola e continua 1-2 minuti, controllando che non trabocchi. Lavora una porzione per volta se sono più di una. Lascia riposare 1 minuto.`, 5);
      add("Completa fuori dal calore", `Incorpora ${list("frutta", "salsa", "proteine in polvere")}. ${optionalGarnish} Ripartisci ogni ingrediente in parti uguali nelle ${servings} porzioni.`, 1);
      break;
    case "caprese-pasta":
      add("Cuoci per assorbimento", `Metti ${list("pasta")} in una padella profonda con ${water(amount("pasta") * 3)}${amount("sale") ? ` e ${list("sale")}` : ""}. Porta a bollore e cuoci 10-12 minuti mescolando, fino a pasta tenera. Se serve aggiungi fino a ${water(50 * servings)} misurati. Lascia intiepidire brevemente.`, 14);
      add("Condisci a crudo", `Unisci ${list("verdure", "formaggio")} tagliati a cubetti${oil ? ` e ${oil}, tutto una sola volta` : ""}. Mescola fuori dal fuoco e dividi in ${servings} porzioni uguali.`, 4);
      break;
    case "creamy-tomato-pasta":
      add("Ammorbidisci i pomodori", `${panStart} Metti ${list("verdure")} tagliati a piccoli pezzi nella padella con ${water(30 * servings)}. Cuoci a fuoco medio-basso per 5 minuti, schiacciando alcuni pezzi con la spatola per creare il fondo. ${optionalSeasoning}`, 5);
      add("Cuoci la pasta nel fondo", `Aggiungi ${list("pasta")}, pesata secca, e ${water(amount("pasta") * 3)}. Porta a leggero bollore e cuoci per 10-12 minuti mescolando, finché la pasta è cotta e rimane un poco di liquido. Se il fondo si asciuga, aggiungi fino a ${water(50 * servings)} misurati. Non aggiungere altri condimenti e non scolare il fondo.`, 13);
      add("Manteca fuori dal fuoco", `Spegni e incorpora l'intera quantità di formaggio prevista (${list("formaggio")}), mescolando delicatamente finché si scioglie nel fondo creando una crema che avvolge la pasta. Non far bollire il formaggio. Se serve fluidificare la salsa, incorpora fino a ${water(20 * servings)}. Distribuisci tutta la pasta, tutti i pomodori e tutta la salsa in ${servings} ${servings === 1 ? "porzione" : "porzioni"}.`, 3);
      break;
    case "ready-pancake-breakfast":
      add("Servi i pancake già cotti", `Distribuisci ${list("pancake")} già pronti al consumo secondo etichetta nei piatti. Spalma ${list("confettura", "crema di arachidi")} ripartendoli uniformemente; usa tutte le quantità. Non preparare una pastella e non dedurre il numero di pancake dal peso. Servi a temperatura di consumo, senza riscaldamento obbligatorio, in ${servings} porzioni.`, 3);
      break;
    case "cereal-yogurt-bowl":
      add("Assembla la ciotola", `Distribuisci ${list("crema")} in ${servings} ciotole.${amount("cacao") ? ` Incorpora ${list("cacao")} nello yogurt mescolando bene.` : ""} Aggiungi tutti i ${list("cereale")} e ${list("cioccolato")} spezzettato, dividendoli uniformemente.${items.some((item) => item.ingredientId === "oats") ? " Usa fiocchi fini: restano leggermente consistenti nella crema fredda, senza ammollo notturno." : ""} Servi subito per mantenere i cereali consistenti; non aggiungere altri ingredienti.`, 3);
      break;
    case "ham-cheese-bread":
      add("Farcisci il pane", `Disponi ${list("pane")} su ${servings} piatti e distribuisci sopra ${list("ripieno", "formaggio")} già pronti al consumo, senza involucri. Usa tutto, anche se occorre servire parte del ripieno a lato; non è necessario tostare o fondere il formaggio.`, 3);
      break;
    case "whey-drink":
      add("Ricostituisci e servi", `Versa ${amount("acqua") ? list("acqua") : water(amount("polvere") * 8)} a temperatura ambiente in un recipiente capiente. Incorpora poco alla volta ${list("polvere")}, mescolando energicamente con una forchetta o frusta manuale fino a sciogliere i grumi. Non occorrono mixer, latte o dolcificanti; non è una crema al cucchiaio. Dividi tutta la bevanda in ${servings} bicchieri e consuma subito.${amount("frutta") ? ` Servi separatamente tutta la ${list("frutta")}, preparata in pezzi edibili e suddivisa uniformemente.` : ""}`, 2);
      break;
    case "fruit-protein-snack":
      add("Prepara lo spuntino", `Distribuisci ${list("frutta")} a pezzi edibili e ${list("snack")} senza involucro in ${servings} porzioni uguali. Servi tutti gli alimenti separatamente sul piatto: si tratta di uno spuntino pronto, non di una ricetta che richiede cottura o altri ingredienti.`, 2);
      break;
    case "egg-lettuce-wrap":
      add("Cuoci le uova", `${panStart} Sbatti ${list("uova")}, il cui peso è senza guscio. ${optionalSeasoning} Versa in padella e cuoci a fuoco medio-basso, mescolando con una spatola, circa 5-7 minuti. Verifica almeno 71 °C al cuore con il termometro alimentare e assenza di parti liquide; prolunga se necessario. Trasferisci in un piatto pulito.`, 8);
      add("Scalda e farcisci", `Nella padella ora libera scalda ${list("piadina")} circa 1 minuto per lato, rispettando anche le istruzioni della confezione. Ripartisci le uova cotte e ${list("verdure")} lavata e asciugata sulla piadina. Distribuisci tutto in ${servings} porzioni, servendo a lato la lattuga che non entra: non scartare il ripieno in eccesso.`, 8);
      break;
    case "brown-rice-salmon":
      add("Cuoci davvero il riso integrale", `Porta a bollore ${water(amount("cereale") * 10)} in una padella profonda con coperchio (circa 3 minuti). Versa ${list("cereale")}, pesato SECCO, e cuoci a leggero bollore per 35-45 minuti secondo confezione, finché tenero. Non usare riso bianco o già cotto al suo posto. Negli ultimi 8 minuti unisci ${list("verdure")} a piccoli cubetti. Se asciuga prima, usa fino a ${water(200 * servings)} aggiuntivi misurati. Scola a fine cottura; se il riso richiede più tempo, prolunga senza servirlo duro.`, 48);
      add("Completa fuori dal fuoco", `Unisci al riso e alle zucchine ${list("proteina")}, già pronto al consumo, tagliato a striscioline. ${list("olio", "acidità", "sale", "spezie") ? `Condisci con tutta la quantità di ${list("olio", "acidità", "sale", "spezie")} una sola volta.` : "Non aggiungere condimenti."} Ripartisci tutto in ${servings} porzioni uguali e servi subito.`, 3);
      break;
    case "white-fish-bread-salad":
      add("Cuoci il merluzzo", `${panStart} Disponi ${list("proteina")} in filetti spessi al massimo 2 cm, senza sovrapporli, con ${water(40 * servings)}. ${optionalSeasoning} Copri e cuoci dolcemente per circa 12-16 minuti; verifica almeno 63 °C al cuore di ciascun filetto con il termometro alimentare. Se necessario prolunga e, se il fondo si asciuga, aggiungi fino a ${water(30 * servings)} misurati.`, 16);
      add("Servi con il contorno", `Disponi tutto il pesce cotto e il suo fondo su ${servings} piatti. Suddividi a lato ${list("verdure", "pane")}. ${optionalFinish} Non aggiungere altri condimenti e non scartare parte della porzione.`, 4);
      break;
    case "seafood-bread-salad":
      add("Assembla senza ricuocere", `Unisci ${list("proteina")}, già cotto, pronto al consumo e pesato sgocciolato senza condimento, a ${list("verdure")}. Non usare un mix crudo o surgelato da cuocere. ${list("olio", "acidità", "sale", "spezie") ? `Aggiungi tutta la quantità di ${list("olio", "acidità", "sale", "spezie")} una sola volta.` : "Non aggiungere condimenti."} Dividi tutto in ${servings} piatti.${amount("pane") ? ` Servi a lato ${list("pane")}, ripartito uniformemente.` : ""} Consuma subito rispettando conservazione e scadenza della confezione.`, 5);
      break;
    case "poultry-fennel-plate":
      add("Cuoci i bocconcini", `${panStart} Disponi ${list("proteina")} a cubetti di circa 1,5 cm nella padella, senza sovrapporli, con ${water(40 * servings)}. ${optionalSeasoning} Cuoci circa 15-17 minuti a fuoco medio-basso, girando spesso; se il fondo si asciuga aggiungi fino a ${water(30 * servings)} misurati. ${safety}`, 17);
      add("Completa il piatto", `Taglia sottilmente ${list("verdure")} e servi crudi a lato dei bocconcini cotti.${amount("pane") ? ` Aggiungi a lato ${list("pane")}.` : ""} ${optionalFinish} Dividi tutta la carne, il fondo di cottura e gli accompagnamenti in ${servings} porzioni uguali.`, 4);
      break;
    case "poultry-fennel-crunch":
      add("Trasforma il pane in due consistenze", `Usa tutti i ${list("pane")}: separa ${formatGrams(amount("pane") / 2)} per un crumble grossolano, tagliandoli finemente al coltello, e i restanti ${formatGrams(amount("pane") / 2)} per crostini a cubetti di circa 1 cm. Queste due quote provengono dallo stesso pane pesato, non da un'aggiunta. Tosta entrambe in padella antiaderente asciutta a fuoco medio-basso per circa 5 minuti, mescolando, finché asciutte e dorate, senza bruciarle.${amount("spezie") ? ` Fuori dal fuoco mescola tutto il pane tostato con ${list("spezie")}.` : ""} Trasferisci crumble e crostini in due recipienti puliti, prima che la padella o gli utensili tocchino la carne cruda.`, 5);
      add("Prepara una vera slaw", `Affetta ${list("verdure")} al coltello in lamelle sottilissime, circa 1 mm, comprese le parti più compatte già mondate. ${list("crema", "acidità", "sale") ? `Lavora ${list("crema", "acidità", "sale")} in una ciotola pulita fino a ottenere un condimento uniforme. Versa tutto sui finocchi e massaggia con mani pulite per un minuto, rivestendo tutte le lamelle.` : "Massaggia le lamelle con mani pulite per un minuto, sfruttando la loro umidità senza aggiungere ingredienti."} Lascia assestare mentre cuoce la carne: i finocchi rimangono crudi e croccanti, ma taglio e massaggio li rendono più flessibili. Tieni la slaw lontana dagli utensili della carne cruda.`, 4);
      add("Dora e cuoci la carne", `${panStart} Disponi ${list("proteina")} a cubetti di circa 1,5 cm in un solo strato. Cuoci a fuoco medio per 3 minuti, girando; versa ${water(30 * servings)}, copri e prosegui 8 minuti. Scopri e lascia ridurre il fondo per circa 3 minuti senza seccare la carne; se necessario aggiungi fino a ${water(20 * servings)} misurati. ${safety} Per più porzioni usa una padella capiente o lavora in turni, prolungando se necessario.`, 14);
      add("Assembla senza perdere la croccantezza", `Ripartisci tutta la slaw e il suo condimento in ${servings} piatti; disponi sopra la carne cotta con tutto il fondo. Solo al momento di servire distribuisci l'intero crumble sulla carne e tutti i crostini sulla slaw. Non immergere il pane nella salsa in anticipo: la parte croccante è il pane tostato, non una finta panatura della carne. Consuma tutte le quote pesate. Per il meal prep conserva pane, slaw e carne separati e assembla soltanto al consumo.`, 3);
      break;
    case "poultry-fennel-tartines":
      add("Tosta la base delle tartine", `Taglia tutti i ${list("pane")} in fette spesse circa 1 cm, senza eliminare la crosta. Tostale nella padella antiaderente asciutta a fuoco medio-basso circa 2 minuti per lato, finché dorate ma non bruciate. Tieni le fette e ogni briciola su un piatto pulito, separati dalla carne cruda: sono l'intera base delle tartine, non pane aggiuntivo.`, 4);
      add("Dora e brasa i finocchi", `${panStart} Affetta ${list("verdure")} in lamelle di circa 2 mm e mettile nella padella: lascia prendere colore per 2 minuti, mescolando. Versa ${water(40 * servings)}; ${optionalSeasoning} copri e cuoci altri 5 minuti, finché teneri ma non sfatti. Trasferisci finocchi e tutto il fondo in una ciotola pulita. Non scartare le parti più compatte: tagliale sottili e cuocile con le altre.`, 7);
      add("Cuoci e sfilaccia", `Nella stessa padella, senza altro olio, disponi ${list("proteina")} in fettine spesse al massimo 1 cm. Cuoci 3 minuti girando, poi versa ${water(30 * servings)}, copri e prosegui circa 7 minuti; se asciuga aggiungi fino a ${water(20 * servings)} misurati. Verifica almeno 74 °C al cuore di ogni fettina con il termometro alimentare; il colore non prova la sicurezza e la cottura va prolungata se necessario. Trasferisci su un piatto pulito, lascia assestare brevemente e sfilaccia con due forchette pulite. Rimetti tutta la carne e i finocchi nella padella con entrambi i fondi, mescolando per raccogliere i succhi. Per più porzioni lavora in turni se necessario.`, 13);
      add("Lega la farcitura e componi", `Spegni il fuoco.${list("crema", "acidità") ? ` Mescola ${list("crema", "acidità")} in una ciotola pulita, poi incorpora l'intero condimento alla carne sfilacciata e ai finocchi, fuori dal fuoco senza far bollire: deve rivestire la farcitura, non essere servito a lato.` : " Mescola la carne sfilacciata ai finocchi brasati e al loro fondo fino a ottenere una farcitura umida, senza aggiungere altri ingredienti."} Distribuisci tutta la farcitura sulle fette tostate, formando tartine aperte da mangiare anche con coltello e forchetta; recupera sopra ogni briciola del piatto. Ripartisci in ${servings} porzioni, senza eliminare il ripieno abbondante o i succhi. Servi subito; per il meal prep conserva base e farcitura separate e componi al consumo.`, 4);
      break;
    case "tomato-cheese-bread":
      add("Assembla il piatto freddo", `Taglia ${list("verdure")} e disponi su ${servings} piatti. Distribuisci ${list("formaggio")}, già pronto al consumo nello stato indicato: a fette o a cucchiaiate secondo il prodotto. ${list("olio", "acidità", "sale", "spezie") ? `Condisci con tutta la quantità di ${list("olio", "acidità", "sale", "spezie")} una sola volta.` : "Non aggiungere condimenti."} Servi con ${list("pane")}; ripartisci e consuma tutti gli ingredienti previsti.`, 5);
      break;
    case "beef-zucchini-patties":
      add("Cuoci le zucchine", `${panStart} Aggiungi ${list("verdure")} tagliate fini e ${water(40 * servings)}. Cuoci 7 minuti mescolando, poi trasferisci in un piatto pulito con il loro fondo. Non mescolare le zucchine all'impasto di carne: sono il contorno.`, 7);
      add("Compatta il macinato", `Lavora brevemente ${list("carne")}${amount("pangrattato") ? ` con ${list("pangrattato")}, incorporando tutta la quantità` : ""}. ${optionalSeasoning} Forma piccoli medaglioni ben compatti, spessi al massimo 1 cm: il macinato lega da solo, senza uovo.${amount("farina") ? ` Distribuisci ${list("farina")} in un piatto e premi i medaglioni su entrambi i lati per far aderire tutta la farina; cuoci anche l'eventuale residuo nel fondo, non servirlo crudo.` : ""} Lava mani e utensili dopo aver toccato la carne cruda.`, 3);
      add("Cuoci e servi", `Nella stessa padella senza altro olio, cuoci i medaglioni circa 5-6 minuti per lato a fuoco medio-basso, anche in più turni. Aggiungi ${water(30 * servings)} misurati per evitare che il fondo asciughi.${amount("farina") ? " Versa nel fondo anche la farina rimasta nel piatto all'inizio della cottura, stemperandola nell'acqua, e falla cuocere completamente." : ""} Verifica almeno 71 °C al cuore di tutti i medaglioni con il termometro alimentare; prolunga se necessario. Servi carne, tutto il fondo cotto e zucchine in ${servings} porzioni uguali.${amount("pane") ? ` Ripartisci anche ${list("pane")}, da servire a lato.` : ""} ${optionalFinish}`, 14);
      break;
    case "tomato-parmesan-pasta":
      add("Ammorbidisci i pomodori", `${panStart} Cuoci ${list("verdure")} a pezzetti con ${water(30 * servings)} per 5 minuti, schiacciandone una parte. ${optionalSeasoning}`, 5);
      add("Cuoci la pasta nel fondo", `Versa ${list("pasta")}, pesata secca, e ${water(amount("pasta") * 3)}. Porta a leggero bollore e cuoci 10-12 minuti, mescolando; se serve aggiungi fino a ${water(50 * servings)} misurati. Non scolare il fondo, che deve restare leggermente liquido.`, 13);
      add("Manteca con tutto il Parmigiano", `Spegni il fuoco e incorpora poco per volta ${list("formaggio")} finemente grattugiato, mescolando per distribuire tutta la quantità senza far bollire. Se serve fluidificare, usa fino a ${water(30 * servings)} misurati. Servi tutta la pasta con tutti i pomodori e il condimento in ${servings} porzioni uguali.`, 3);
      break;
    default:
      throw new Error(`Istruzioni mancanti per l'archetipo ${template.id}.`);
  }
  if (amount("bevanda")) {
    drafts[drafts.length - 1][1] += ` Servi separatamente ${list("bevanda")}, già preparato senza zucchero né latte, dividendolo in ${servings} tazze: non incorporarlo negli altri alimenti.`;
  }
  // Extra portions require explicit preparation/batch time, rather than a free scale-up.
  drafts[0][2] += template.extraServingMinutes * (servings - 1);
  return drafts.map(([title, instruction, minutes], index) => ({
    id: `step-${index + 1}`, title, instruction, minutes,
  }));
}
