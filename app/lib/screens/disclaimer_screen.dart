import 'package:flutter/material.dart';

const _navy = Color(0xFF123B56);
const _ocean = Color(0xFF008FAA);
const _coral = Color(0xFFFF7557);
const _inkMuted = Color(0xFF537788);

const disclaimerOpenMeteoTermsUrl = 'https://open-meteo.com/en/terms';
const disclaimerOpenStreetMapUrl =
    'https://www.openstreetmap.org/copyright';

/// Pagina informativa sull'origine dei dati e sull'uso responsabile delle
/// previsioni (FR-122, NFR-7, FR-90).
class DisclaimerScreen extends StatelessWidget {
  const DisclaimerScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5FCFA),
      appBar: AppBar(
        title: const Text('Informazioni'),
        backgroundColor: const Color(0xFFD8F7F4),
        foregroundColor: _navy,
        elevation: 0,
      ),
      body: SafeArea(
        child: ListView(
          key: const Key('disclaimer-list'),
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
          children: const [
            _Intro(),
            SizedBox(height: 16),
            _Section(
              key: Key('disclaimer-data-sources'),
              icon: Icons.cloud_outlined,
              title: 'Le fonti dei dati',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Body(
                    'Le previsioni di Maestrale sono elaborate a partire dai '
                    'dati aperti di Open-Meteo e aggregate per produrre i '
                    'valori giornalieri mostrati. Alcuni indicatori, come lo '
                    'stato del mare e la direzione del vento, sono calcolati '
                    'da Maestrale a partire da quei dati.',
                  ),
                  SizedBox(height: 8),
                  _Bullet(
                    'Open-Meteo Marine Weather API: altezza, periodo e '
                    'direzione delle onde, temperatura dell’acqua.',
                  ),
                  _Bullet(
                    'Open-Meteo Weather Forecast API: temperature dell’aria, '
                    'vento, raffiche e condizioni meteo.',
                  ),
                  SizedBox(height: 12),
                  _Url(
                    'Dati meteorologici forniti da Open-Meteo.com (CC BY 4.0).\n'
                    'Condizioni d’uso e licenza: $disclaimerOpenMeteoTermsUrl',
                  ),
                  SizedBox(height: 8),
                  _Body(
                    'Le condizioni d’uso e le licenze sono quelle dei rispettivi '
                    'fornitori.',
                  ),
                ],
              ),
            ),
            SizedBox(height: 14),
            _Section(
              key: Key('disclaimer-map'),
              icon: Icons.map_outlined,
              title: 'Mappa e catalogo',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Body(
                    'La mappa usa le tile di OpenStreetMap '
                    '(© OpenStreetMap contributors, licenza ODbL). Il catalogo '
                    'delle località è gestito direttamente da Maestrale e non '
                    'proviene da Open-Meteo.',
                  ),
                  SizedBox(height: 12),
                  _Url(
                    'Licenza e copyright: $disclaimerOpenStreetMapUrl',
                  ),
                ],
              ),
            ),
            SizedBox(height: 14),
            _Section(
              key: Key('disclaimer-forecasts'),
              icon: Icons.online_prediction_rounded,
              title: 'Previsioni, non misure',
              child: _Body(
                'I valori mostrati sono previsioni elaborate da un modello '
                'meteo, non misure osservate. Lo storico riporta i valori '
                'previsti per il giorno stesso, non i dati realmente '
                'registrati. Il modello usato da Open-Meteo (best_match) può '
                'cambiare nel tempo e tra località: i valori non sono '
                'riproducibili rispetto a un modello fisso.',
              ),
            ),
            SizedBox(height: 14),
            _Section(
              key: Key('disclaimer-responsible-use'),
              icon: Icons.support_agent_rounded,
              title: 'Uso responsabile',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Body(
                    'Maestrale è uno strumento informativo. Non sostituisce i '
                    'bollettini, gli avvisi e le ordinanze delle autorità '
                    'competenti, come Guardia Costiera, Capitanerie di porto e '
                    'Protezione Civile.',
                  ),
                  SizedBox(height: 8),
                  _Body(
                    'Non usare queste previsioni come unica fonte per decidere '
                    'di uscire in mare o per la sicurezza della navigazione: '
                    'verifica sempre le condizioni reali, il meteo locale e gli '
                    'avvisi ufficiali.',
                  ),
                  SizedBox(height: 12),
                  _WarningBox(
                    'Le previsioni possono essere inaccurate, incomplete o non '
                    'aggiornate. Maestrale non è un dispositivo di sicurezza né '
                    'un servizio di emergenza: in caso di pericolo chiama il '
                    '112.',
                  ),
                ],
              ),
            ),
            SizedBox(height: 14),
            _Section(
              key: Key('disclaimer-updates'),
              icon: Icons.schedule_rounded,
              title: 'Aggiornamento e disponibilità',
              child: _Body(
                'Le previsioni sono aggiornate periodicamente, ogni sei ore, e '
                'servite da una cache. Possono essere temporaneamente non '
                'disponibili o riferirsi all’ultimo aggiornamento riuscito: la '
                'data e l’ora sono indicate con ogni previsione.',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Intro extends StatelessWidget {
  const _Intro();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF00A9BC), Color(0xFF087DA6)],
        ),
        borderRadius: BorderRadius.circular(26),
        boxShadow: const [
          BoxShadow(
            color: Color(0x2E007F96),
            blurRadius: 22,
            offset: Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(15),
            ),
            child: const Icon(Icons.info_outline_rounded, color: Colors.white),
          ),
          const SizedBox(height: 14),
          const Text(
            'Trasparenza sui dati',
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w900,
              letterSpacing: -0.4,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Maestrale mostra previsioni marine e meteo per le località '
            'costiere della Sardegna. Qui spieghiamo da dove arrivano i dati '
            'e come usarli in modo responsabile.',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.9),
              fontSize: 14,
              height: 1.45,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    super.key,
    required this.icon,
    required this.title,
    required this.child,
  });

  final IconData icon;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1207536A),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: const Color(0xFFE0FAF7),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: _ocean, size: 21),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(
                    title,
                    style: const TextStyle(
                      color: _navy,
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -0.2,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        color: _inkMuted,
        fontSize: 14,
        height: 1.5,
        fontWeight: FontWeight.w500,
      ),
    );
  }
}

class _Bullet extends StatelessWidget {
  const _Bullet(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 7),
            child: Icon(Icons.circle, size: 6, color: _ocean),
          ),
          const SizedBox(width: 9),
          Expanded(child: _Body(text)),
        ],
      ),
    );
  }
}

class _Url extends StatelessWidget {
  const _Url(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFF2FBFC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFCCEDF1)),
      ),
      child: SelectableText(
        text,
        style: const TextStyle(
          color: _ocean,
          fontSize: 12,
          height: 1.45,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _WarningBox extends StatelessWidget {
  const _WarningBox(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF1EC),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFFD3C7)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.warning_amber_rounded, color: _coral, size: 21),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                color: Color(0xFF8A3A27),
                fontSize: 13,
                height: 1.45,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
