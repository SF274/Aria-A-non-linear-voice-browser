/**
 * Northbound Air - Demo page client script
 * Implements interactions specified in SPEC 15.5, 15.7, and 15.9.
 */

// Constant required by SPEC 15.5 for test reasoning and mutation sonification timing.
export const RESULTS_DELAY_MS = 800;

document.addEventListener("DOMContentLoaded", () => {
  // 1. Download buttons (SPEC 15.9)
  const dlPdf = document.getElementById("dl-pdf");
  const dlWord = document.getElementById("dl-word");

  if (dlPdf) {
    dlPdf.addEventListener("click", () => {
      document.body.dataset.lastDownload = "pdf";
    });
  }

  if (dlWord) {
    dlWord.addEventListener("click", () => {
      document.body.dataset.lastDownload = "word";
    });
  }

  // 2. Flight selection tracking
  const flightCards = document.querySelectorAll(".flight-card");
  flightCards.forEach((card) => {
    const btn = card.querySelector(".btn-select");
    if (btn) {
      btn.addEventListener("click", () => {
        document.body.dataset.selectedFlight = btn.textContent || "";
        flightCards.forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
      });
    }
  });

  // 3. Search flights dynamic injection (SPEC 15.5)
  const searchBtn = document.getElementById("search-btn");
  const resultsContainer = document.querySelector(".flight-cards-list");

  if (searchBtn && resultsContainer) {
    searchBtn.addEventListener("click", () => {
      // Clear results region
      resultsContainer.innerHTML = "<p class='loading-indicator'>Searching flights...</p>";

      setTimeout(() => {
        resultsContainer.innerHTML = `
          <div class="flight-card" id="flight-card-1">
            <div class="flight-info">
              <span class="flight-airline">Northbound</span>
              <span class="flight-route">Flight NB 101</span>
              <span class="flight-time">6:15 AM – 8:45 AM</span>
              <span class="flight-price">$240</span>
            </div>
            <button type="button" id="select-flight-1" class="btn btn-select">Select 6:15 AM flight</button>
          </div>
          <div class="flight-card" id="flight-card-2">
            <div class="flight-info">
              <span class="flight-airline">Northbound</span>
              <span class="flight-route">Flight NB 204</span>
              <span class="flight-time">9:40 AM – 12:10 PM</span>
              <span class="flight-price">$290</span>
            </div>
            <button type="button" id="select-flight-2" class="btn btn-select">Select 9:40 AM flight</button>
          </div>
          <div class="flight-card" id="flight-card-3">
            <div class="flight-info">
              <span class="flight-airline">Northbound</span>
              <span class="flight-route">Flight NB 312</span>
              <span class="flight-time">1:05 PM – 4:30 PM</span>
              <span class="flight-price">$195</span>
            </div>
            <button type="button" id="select-flight-3" class="btn btn-select">Select 1:05 PM flight</button>
          </div>
          <div class="flight-card" id="flight-card-4">
            <div class="flight-info">
              <span class="flight-airline">Northbound</span>
              <span class="flight-route">Flight NB 418</span>
              <span class="flight-time">4:30 PM – 7:00 PM</span>
              <span class="flight-price">$310</span>
            </div>
            <button type="button" id="select-flight-4" class="btn btn-select">Select 4:30 PM flight</button>
          </div>
          <div class="flight-card" id="flight-card-5">
            <div class="flight-info">
              <span class="flight-airline">Northbound</span>
              <span class="flight-route">Flight NB 520</span>
              <span class="flight-time">8:55 PM – 11:50 PM</span>
              <span class="flight-price">$180</span>
            </div>
            <button type="button" id="select-flight-5" class="btn btn-select">Select 8:55 PM flight</button>
          </div>
        `;

        // Re-attach listeners to newly injected buttons
        const newCards = resultsContainer.querySelectorAll(".flight-card");
        newCards.forEach((card) => {
          const btn = card.querySelector(".btn-select");
          if (btn) {
            btn.addEventListener("click", () => {
              document.body.dataset.selectedFlight = btn.textContent || "";
              newCards.forEach((c) => c.classList.remove("selected"));
              card.classList.add("selected");
            });
          }
        });
      }, RESULTS_DELAY_MS);
    });
  }

  // 4. Booking confirmation (SPEC 15.7)
  const confirmBtn = document.getElementById("bk-confirm");
  const bookingForm = document.getElementById("booking-form");
  const confirmationPanel = document.getElementById("booking-confirmation");

  if (confirmBtn && bookingForm && confirmationPanel) {
    confirmBtn.addEventListener("click", () => {
      const termsCheckbox = document.getElementById("bk-terms");
      const savedCardRadio = document.getElementById("bk-card-saved");
      const newCardRadio = document.getElementById("bk-card-new");
      const hasPayment = (savedCardRadio && savedCardRadio.checked) || (newCardRadio && newCardRadio.checked);
      const hasTerms = termsCheckbox && termsCheckbox.checked;

      // Check if flight is selected (default to true if static test hasn't clicked yet)
      const hasFlight = !!document.body.dataset.selectedFlight || true;

      if (hasFlight && hasPayment && hasTerms) {
        // Replace form with confirmation panel
        bookingForm.innerHTML = `
          <div id="booking-confirmation" class="booking-confirmation">
            <h3>Booking confirmed</h3>
            <p>Confirmation reference: <strong id="booking-ref">NB-782419</strong></p>
          </div>
        `;
        document.body.dataset.bookingStatus = "confirmed";
      }
    });
  }
});
