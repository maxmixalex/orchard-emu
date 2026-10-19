# SPDX-License-Identifier: MIT
# Included before compiler/sanitizer options are applied to checked targets.
if(BUILD_TESTING)
  add_executable(orchard-clock-domains tests/clock-domains.c)
  target_link_libraries(orchard-clock-domains PRIVATE orchard)
  target_include_directories(orchard-clock-domains PRIVATE src)
  set_target_properties(orchard-clock-domains PROPERTIES C_EXTENSIONS OFF)
  add_test(NAME clock-domain-regression COMMAND orchard-clock-domains)
  set_tests_properties(clock-domain-regression PROPERTIES TIMEOUT 30)
  list(APPEND orchard_checked_targets orchard-clock-domains)
endif()
install(FILES include/orchard/clock.h DESTINATION include/orchard)
