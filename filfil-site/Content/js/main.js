
   
    //products slider
    var productslider = new Swiper('.products-section__slider', {
        speed: 900,
        slidesPerView: 5,
        spaceBetween: 50,
        navigation: {
            nextEl: '.products-slider-next',
            prevEl: '.products-slider-prev',
        },
        autoplay: {
            delay: 4700,
            disableOnInteraction: false
        },
        watchSlidesVisibility: true,
        watchSlidesProgress: true,
        breakpoints: {
            719: {
                slidesPerView: 2,
            },
            479: {
                slidesPerView: 1,
            },
        }
    });

