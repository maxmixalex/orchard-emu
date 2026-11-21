# SPDX-License-Identifier: MIT
# Included before compiler/sanitizer options are applied to checked targets.
if(BUILD_TESTING)
  add_executable(orchard-clock-domains tests/clock-domains.c)
  target_link_libraries(orchard-clock-domains PRIVATE orchard)
  target_include_directories(orchard-clock-domains PRIVATE src)
  set_target_properties(orchard-clock-domains PROPERTIES C_EXTENSIONS OFF)
  add_test(NAME clock-domain-regression COMMAND orchard-clock-domains)
  # The seven-profile full-state comparison takes about 39s with GCC
  # ASAN/UBSAN at -O1 (about 2.4s in Release). Keep a finite, measured
  # instrumentation allowance without weakening the ordinary test bound.
  if(ORCHARD_SANITIZE)
    set_tests_properties(clock-domain-regression PROPERTIES TIMEOUT 60)
  else()
    set_tests_properties(clock-domain-regression PROPERTIES TIMEOUT 30)
  endif()
  list(APPEND orchard_checked_targets orchard-clock-domains)
endif()
install(FILES include/orchard/clock.h DESTINATION include/orchard)
