# Maestrale — app Flutter

Client mobile del backend FastAPI. Cerca una località costiera e mostra le medie
giornaliere di onde, temperatura dell'acqua, temperatura dell'aria e vento. Una
località può essere impostata come pagina iniziale: viene salvata sul dispositivo
e caricata automaticamente agli avvii successivi. L'icona mappa nella barra
superiore apre una schermata dedicata con ricerca e pin di tutte le località
supportate. La località confermata torna alla home e carica le sue previsioni.
All'apertura della mappa l'app richiede il permesso di localizzazione mentre è
in uso, centra la vista sulla posizione corrente e mostra un pin personale. Il
pulsante con il mirino permette di aggiornare e ricentrare la posizione; se il
GPS o il permesso non sono disponibili resta accessibile la vista completa della
costa.
I tile sono caricati senza la cache nativa di `flutter_map`, per mantenere la
mappa compatibile anche con le build macOS/iOS che non includono gli asset FFI
di `objective_c`.

## Avvio

Avvia prima il backend dalla root del repository, poi:

```bash
cd app
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:8000
```

`API_BASE_URL` non deve terminare con `/`. Il valore predefinito è
`http://localhost:8000`.

Indirizzi utili in sviluppo:

- iOS Simulator, macOS, web: `http://localhost:8000`
- Android Emulator: `http://10.0.2.2:8000`
- dispositivo fisico: `http://<IP-LAN-del-computer>:8000` (backend in ascolto su
  `0.0.0.0` e dispositivo sulla stessa rete)

Per una build di produzione usare un endpoint HTTPS. Il manifest Android accetta
HTTP in chiaro esclusivamente per facilitare lo sviluppo locale.

## API consumata

La ricerca chiama:

```text
GET /forecast?localita=Torre%20dei%20Corsari
```

Il client usa i blocchi `location`, `daily[].sea` e `daily[].weather` restituiti
dal backend. L'URL è centralizzato in `lib/config/api_config.dart` e il parsing in
`lib/models/forecast.dart`.

## Verifiche

```bash
flutter analyze
flutter test
```
